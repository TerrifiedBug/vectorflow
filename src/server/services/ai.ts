import { prisma } from "@/lib/prisma";
import { decrypt } from "./crypto";
import { checkRateLimit } from "@/lib/ai/rate-limiter";
import { isDemoMode } from "@/lib/is-demo-mode";
import { validateOutboundUrl } from "@/server/services/url-validation";
import { enforceAiBaseUrlPolicy } from "@/server/services/ai-base-url-allowlist";

const ENCRYPTED_PREFIX = "enc:";

/**
 * SSRF guard for AI provider base URLs.
 *
 * Single source of policy: defers to `validateOutboundUrl`. In OSS (the
 * default) outbound validation is gated by `VF_STRICT_OUTBOUND` so a
 * self-hosted Ollama at `http://localhost:11434/v1` keeps working. In Cloud
 * (`VF_STRICT_OUTBOUND=true`) AI providers MUST be public hosts; private
 * IPs, loopback, mDNS/.internal TLDs, and cloud metadata endpoints are all
 * rejected before the request goes out.
 *
 * The function also enforces the `http(s)` scheme requirement; the previous
 * in-file `validateBaseUrl` did the same with a bespoke list of CIDRs and a
 * narrower IPv6 coverage. Centralising the policy means every outbound
 * callsite (AI, cost-optimizer-ai, migration translator, webhooks, vault,
 * context7) shares the same rule set.
 */
async function validateBaseUrl(baseUrl: string): Promise<void> {
  // Always enforce scheme — `validateOutboundUrl` short-circuits when
  // VF_STRICT_OUTBOUND is unset, so without this check OSS users
  // would silently accept `file://` or other unsupported schemes.
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Invalid AI base URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("AI base URL must use http or https");
  }
  await validateOutboundUrl(baseUrl);
}

interface StreamCompletionParams {
  teamId: string;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  onToken: (token: string) => void;
  signal?: AbortSignal;
}

function decryptApiKey(encryptedKey: string): string {
  if (encryptedKey.startsWith(ENCRYPTED_PREFIX)) {
    return decrypt(encryptedKey.slice(ENCRYPTED_PREFIX.length));
  }
  return encryptedKey;
}

function getDefaultBaseUrl(provider: string | null): string {
  switch (provider) {
    case "anthropic":
      return "https://api.anthropic.com/v1";
    case "openai":
    default:
      return "https://api.openai.com/v1";
  }
}

export async function getTeamAiConfig(teamId: string, { requireEnabled = true } = {}) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      organizationId: true,
      aiEnabled: true,
      aiProvider: true,
      aiBaseUrl: true,
      aiApiKey: true,
      aiModel: true,
    },
  });

  if (!team) throw new Error("Team not found");
  if (requireEnabled && !team.aiEnabled) throw new Error("AI is not enabled for this team");
  if (!team.aiApiKey) throw new Error("AI API key is not configured");

  return {
    organizationId: team.organizationId,
    provider: team.aiProvider ?? "openai",
    baseUrl: team.aiBaseUrl || getDefaultBaseUrl(team.aiProvider),
    apiKey: decryptApiKey(team.aiApiKey),
    model: team.aiModel ?? "gpt-4o",
  };
}

export async function streamCompletion({
  teamId,
  systemPrompt,
  messages,
  onToken,
  signal,
}: StreamCompletionParams): Promise<void> {
  if (isDemoMode()) {
    onToken("AI features are disabled in the public demo.");
    return;
  }

  const rateLimit = checkRateLimit(teamId);
  if (!rateLimit.allowed) {
    throw new Error(
      `Rate limit exceeded. Resets at ${new Date(rateLimit.resetAt).toISOString()}`
    );
  }

  const config = await getTeamAiConfig(teamId);
  await validateBaseUrl(config.baseUrl);
  // Phase 5z: gate non-vendor URLs on the per-org opt-in.
  await enforceAiBaseUrlPolicy({
    baseUrl: config.baseUrl,
    organizationId: config.organizationId,
  });

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      messages: [
        { role: "system" as const, content: systemPrompt },
        ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      ],
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`AI provider error (${response.status}): ${errorText}`);
  }

  if (!response.body) {
    throw new Error("No response body from AI provider");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") return;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            onToken(content);
          }
        } catch {
          // Skip malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function testAiConnection(teamId: string): Promise<{ ok: boolean; error?: string }> {
  if (isDemoMode()) {
    return { ok: false, error: "AI features are disabled in the public demo." };
  }

  try {
    const config = await getTeamAiConfig(teamId, { requireEnabled: false });
    await validateBaseUrl(config.baseUrl);
    // Phase 5z: gate non-vendor URLs on the per-org opt-in.
    await enforceAiBaseUrlPolicy({
      baseUrl: config.baseUrl,
      organizationId: config.organizationId,
    });

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 5,
        messages: [{ role: "user", content: "Say hi" }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      return { ok: false, error: `${response.status}: ${errorText}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
