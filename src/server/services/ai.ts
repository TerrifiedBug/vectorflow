import { prisma } from "@/lib/prisma";
import { ENCRYPTION_DOMAINS } from "./crypto";
import {
  decryptForOrgOrFallback,
  loadOrgDataKeyCiphertext,
} from "./crypto-v3-callsite";
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
 * self-hosted Ollama at `http://localhost:11434/v1` keeps working. Under
 * the strict-outbound profile (`VF_STRICT_OUTBOUND=true`) AI providers
 * MUST be public hosts; private IPs, loopback, mDNS/.internal TLDs, and
 * cloud-metadata endpoints are all rejected before the request goes out.
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

/**
 * Decrypt a Team.aiApiKey ciphertext through the v3-or-v2 wrapper.
 *
 * Column history:
 *   - Legacy/plaintext: key stored without any prefix (no encryption). Some
 *     manual-import / old-version rows may still carry this shape.
 *   - v2 shape: `"enc:" + <v2-ciphertext>`
 *   - v3 shape: `"enc:" + "v3:" + <v3-ciphertext>`
 *
 * We preserve the plaintext fallback: if the stored value has no `enc:`
 * prefix it is returned as-is so existing deployments that stored raw keys
 * continue to work.
 */
async function decryptTeamAiApiKey(args: {
  encryptedKey: string;
  organizationId: string;
  teamId: string;
  dataKeyCiphertext: string | null;
}): Promise<string> {
  if (!args.encryptedKey.startsWith(ENCRYPTED_PREFIX)) {
    // Legacy plaintext key — return as-is (no encryption to undo).
    return args.encryptedKey;
  }
  const stripped = args.encryptedKey.slice(ENCRYPTED_PREFIX.length);
  return decryptForOrgOrFallback(stripped, {
    orgId: args.organizationId,
    dataKeyCiphertext: args.dataKeyCiphertext,
    domain: ENCRYPTION_DOMAINS.GENERIC,
    rowTable: "Team",
    rowId: args.teamId,
  });
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

  const dataKeyCiphertext = await loadOrgDataKeyCiphertext(team.organizationId);
  const apiKey = await decryptTeamAiApiKey({
    encryptedKey: team.aiApiKey,
    organizationId: team.organizationId,
    teamId,
    dataKeyCiphertext,
  });

  return {
    organizationId: team.organizationId,
    provider: team.aiProvider ?? "openai",
    baseUrl: team.aiBaseUrl || getDefaultBaseUrl(team.aiProvider),
    apiKey,
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
  // Gate non-vendor URLs on the per-org opt-in.
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

/**
 * Non-streaming convenience over `streamCompletion`: accumulate the streamed
 * tokens into a single string. Reuses the exact same per-team BYO-key
 * resolution, rate-limit, SSRF and base-url-allowlist gating — so the agentic
 * propose / auto-fix loop (B2) never opens a second outbound path. Returns the
 * full completion text.
 */
export async function completeChat(params: {
  teamId: string;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  signal?: AbortSignal;
}): Promise<string> {
  let out = "";
  await streamCompletion({
    teamId: params.teamId,
    systemPrompt: params.systemPrompt,
    messages: params.messages,
    onToken: (token) => {
      out += token;
    },
    signal: params.signal,
  });
  return out;
}

export async function testAiConnection(teamId: string): Promise<{ ok: boolean; error?: string }> {
  if (isDemoMode()) {
    return { ok: false, error: "AI features are disabled in the public demo." };
  }

  try {
    const config = await getTeamAiConfig(teamId, { requireEnabled: false });
    await validateBaseUrl(config.baseUrl);
    // Gate non-vendor URLs on the per-org opt-in.
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
