/**
 * Per-organization sliding-window rate limit.
 *
 * Wraps the existing `rateLimiter.checkKey` primitive (Redis-backed,
 * falls back to in-process memory) with a key scheme that scopes each
 * bucket to `(orgId, endpoint)`. Layered on top of the IP-keyed limit
 * (`checkIpRateLimit`) and the token-keyed limit (`checkTokenRateLimit`)
 * — those stay as DoS pre-filters; this prevents one noisy tenant from
 * burning all of another tenant's quota.
 *
 * Default limits:
 *   trpc:     1000 / min
 *   agent:    6000 / min (heartbeat-heavy)
 *   ai:         60 / min
 *   git-sync:  120 / min
 *
 * Callers may override the per-endpoint default by passing an explicit
 * `limit` (plan-tier-aware quota wiring lives in Phase 5 quota engine,
 * which will compute the override based on `OrgPlan`).
 */

import { rateLimiter } from "@/app/api/v1/_lib/rate-limiter";

export type OrgRateLimitEndpoint = "trpc" | "agent" | "ai" | "git-sync";

export const ORG_RATE_LIMITS: Record<OrgRateLimitEndpoint, number> = {
  trpc: 1000,
  agent: 6000,
  ai: 60,
  "git-sync": 120,
};

// Plain-identifier grammar, mirroring `withOrgTx`. Defends against
// key-prefix injection when an orgId would otherwise be concatenated
// directly into the Redis key string.
const ORG_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function validateOrgId(orgId: string): void {
  if (typeof orgId !== "string" || orgId.length === 0 || orgId.length > 64) {
    throw new Error("checkOrgRateLimit: orgId must be a non-empty string ≤ 64 chars");
  }
  if (!ORG_ID_PATTERN.test(orgId)) {
    throw new Error(
      "checkOrgRateLimit: orgId must match /^[A-Za-z0-9_-]+$/ — got invalid characters",
    );
  }
}

/**
 * Check the per-org rate limit for `(orgId, endpoint)`. Returns `null`
 * when the request is allowed, or a `Response(429)` carrying
 * `Retry-After` when the limit is exceeded — call sites return it
 * directly:
 *
 * ```ts
 * const limited = await checkOrgRateLimit(orgId, "agent");
 * if (limited) return limited;
 * ```
 */
export async function checkOrgRateLimit(
  orgId: string,
  endpoint: OrgRateLimitEndpoint,
  limit?: number,
): Promise<Response | null> {
  validateOrgId(orgId);
  const effectiveLimit = limit ?? ORG_RATE_LIMITS[endpoint];
  const key = `org:${orgId}:${endpoint}`;
  const result = await rateLimiter.checkKey(key, effectiveLimit);
  if (result.allowed) return null;
  return new Response(
    JSON.stringify({
      error: "rate limit exceeded",
      scope: "organization",
      endpoint,
      retryAfter: result.retryAfter,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(result.retryAfter),
      },
    },
  );
}
