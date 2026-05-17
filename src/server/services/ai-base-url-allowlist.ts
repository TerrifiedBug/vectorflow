/**
 * AI provider base-URL allowlist.
 *
 * Two layers of policy compose:
 *
 *   1. **`validateOutboundUrl`** — the unified
 *      SSRF gate. Rejects private IPs, mDNS, .internal TLDs, cloud
 *      metadata endpoints, etc. Gated by `VF_STRICT_OUTBOUND`.
 *
 *   2. **This module** — even AFTER `validateOutboundUrl` accepts a URL
 *      as "not pointing at a private network", we still want to
 *      restrict AI calls to a known set of vendor endpoints by default.
 *      The allowlist is `api.openai.com` and `api.anthropic.com` (and
 *      subdomains of either). An org admin can opt out by flipping
 *      `OrganizationSettings.aiBaseUrlOptIn = true`.
 *
 * Why both layers? `validateOutboundUrl` answers "is this URL safe to
 * fetch from a tenant-of-record's perspective". The allowlist answers
 * "is this URL one we trust to receive prompt + API-key payloads".
 * Conflating the two would either over-block (legitimate non-AI
 * outbound calls would have to pass the allowlist) or under-block (an
 * AI call to attacker.example would pass SSRF but leak the API key).
 *
 * The opt-in flag is intentionally per-organisation, not per-team. AI
 * provider choice is a business decision that the org owner makes
 * once; per-team baseUrl overrides still must satisfy the policy.
 */
import { prisma } from "@/lib/prisma";
import { isStrictOutboundMode } from "@/server/services/url-validation";

/**
 * Hostnames we accept by default. A URL whose hostname equals one of
 * these OR ends with `.<allow>` (subdomain) passes the allowlist.
 */
export const AI_PROVIDER_ALLOWLIST: ReadonlyArray<string> = [
  "api.openai.com",
  "api.anthropic.com",
];

export class AiBaseUrlNotAllowedError extends Error {
  readonly _tag = "AiBaseUrlNotAllowedError" as const;
  constructor(
    public readonly host: string,
    public readonly organizationId: string,
  ) {
    super(
      `AI base URL "${host}" is not in the allowlist and ` +
        `organization ${organizationId} has not opted into custom providers.`,
    );
    this.name = "AiBaseUrlNotAllowedError";
  }
}

/**
 * True when `hostname` is in `AI_PROVIDER_ALLOWLIST` or is a subdomain
 * of an allowlisted entry. Comparison is case-insensitive; punycode is
 * the caller's responsibility (we only get here after `new URL(...)`
 * parsing, which already normalises to ASCII).
 */
export function isAllowlistedAiHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return AI_PROVIDER_ALLOWLIST.some(
    (allow) => lower === allow || lower.endsWith(`.${allow}`),
  );
}

/**
 * Parse `baseUrl` and return its hostname. Throws on non-http(s)
 * schemes — those are SSRF-relevant and `validateOutboundUrl` will
 * also reject, but we want a clear error here too.
 */
function hostnameOf(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid AI base URL: ${baseUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("AI base URL must use http or https");
  }
  return parsed.hostname;
}

/**
 * Enforce the AI-base-URL policy at call-time. Order of checks:
 *
 *   0. If `VF_STRICT_OUTBOUND` is unset (OSS default) → skip.
 *      Parity with `validateOutboundUrl` — self-hosted users routinely
 *      target localhost / Ollama / vLLM and we do not want a hard
 *      allowlist policy to break their config out of the box.
 *   1. Parse the URL — reject non-http(s).
 *   2. If host is allowlisted → accept (fast path, no DB hit).
 *   3. Otherwise → consult `OrganizationSettings.aiBaseUrlOptIn`:
 *      - flag true  → accept (admin has opted into custom providers)
 *      - flag false → throw `AiBaseUrlNotAllowedError`
 *
 * Callers SHOULD pair this with `validateOutboundUrl(baseUrl)` from
 * Phase 5u. The two policies compose: allowlist gates which vendor
 * payloads (API keys, prompt content) go to; `validateOutboundUrl`
 * gates whether the network destination is safe at all.
 */
export async function enforceAiBaseUrlPolicy(opts: {
  baseUrl: string;
  organizationId: string;
}): Promise<void> {
  if (!isStrictOutboundMode()) return;

  const host = hostnameOf(opts.baseUrl);
  if (isAllowlistedAiHost(host)) return;

  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId: opts.organizationId },
    select: { aiBaseUrlOptIn: true },
  });
  if (settings?.aiBaseUrlOptIn === true) return;

  throw new AiBaseUrlNotAllowedError(host, opts.organizationId);
}
