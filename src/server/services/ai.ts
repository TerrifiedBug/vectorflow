import { prisma } from "@/lib/prisma";
import { decrypt } from "./crypto";
import { checkRateLimit } from "@/lib/ai/rate-limiter";

const ENCRYPTED_PREFIX = "enc:";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function validateBaseUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Invalid AI base URL");
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error("AI base URL must use http or https");
  }

  // URL.hostname strips brackets from IPv6 and normalises numeric encodings
  const hostname = parsed.hostname.toLowerCase();

  const isBlocked =
    // Loopback
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    hostname === "::" ||
    // mDNS / internal TLDs
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    // IPv4 private ranges
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    // Link-local (full range)
    hostname.startsWith("169.254.") ||
    // Cloud metadata endpoints
    hostname === "metadata.google.internal" ||
    // IPv6 link-local, unique-local, and IPv4-mapped
    hostname.startsWith("fe80:") ||
    hostname.startsWith("fc00:") ||
    hostname.startsWith("fd00:") ||
    hostname.startsWith("::ffff:");

  if (isBlocked) {
    throw new Error("AI base URL must not point to internal or private addresses");
  }
}

interface StreamCompletionParams {
  teamId: string;
  systemPrompt: string;
  userPrompt: string;
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
    provider: team.aiProvider ?? "openai",
    baseUrl: team.aiBaseUrl || getDefaultBaseUrl(team.aiProvider),
    apiKey: decryptApiKey(team.aiApiKey),
    model: team.aiModel ?? "gpt-4o",
  };
}

export async function streamCompletion({
  teamId,
  systemPrompt,
  userPrompt,
  onToken,
  signal,
}: StreamCompletionParams): Promise<void> {
  const rateLimit = checkRateLimit(teamId);
  if (!rateLimit.allowed) {
    throw new Error(
      `Rate limit exceeded. Resets at ${new Date(rateLimit.resetAt).toISOString()}`
    );
  }

  const config = await getTeamAiConfig(teamId);
  validateBaseUrl(config.baseUrl);

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
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
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
  try {
    const config = await getTeamAiConfig(teamId, { requireEnabled: false });
    validateBaseUrl(config.baseUrl);

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
