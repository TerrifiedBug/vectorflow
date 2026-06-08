/**
 * Resolve the organization an incoming HTTP request belongs to from its
 * `Host:` header.
 *
 * Wildcard subdomain layout: `<orgSlug>.vectorflow.sh` (and
 * `<orgSlug>.agents.vectorflow.sh` for the agent ingress). The first DNS
 * label of the request host is therefore the tenant slug, and routes that
 * load per-org configuration (OIDC settings, brand colours, etc.) MUST
 * use that — not a hardcoded `DEFAULT_ORG_ID`.
 *
 * OSS deployments do not use the wildcard scheme; their hosts are
 * single-label (`localhost`), bare IP, or a custom domain that intentionally
 * does NOT include an org-slug prefix. For those, this helper falls back
 * to `DEFAULT_ORG_ID` so OSS users see no behaviour change.
 *
 * Custom domains (e.g. `logs.acme.com` CNAME'd at the platform) are routed
 * via a *verified* `OrganizationDomainClaim` (DNS-TXT ownership). When the
 * host is not a recognised `<orgSlug>` subdomain, a verified claim whose
 * `domain` equals the full host wins; otherwise we still fall back to
 * `DEFAULT_ORG_ID`. That lookup is a DB read, so it is Node-runtime only
 * (see the boundary note on `resolveOrgIdFromHost`).
 *
 * The slug grammar is the same one used by enrollment tokens
 * (`isValidOrgSlug`): lowercase letters/digits/hyphens, 3–31 chars,
 * starts with a letter. This shared grammar is what makes
 * `<orgSlug>.vectorflow.sh` and `vf_enroll_<orgSlug>_…` consistent.
 */
import { adminPrisma } from "@/lib/prisma";
import { DEFAULT_ORG_ID } from "@/lib/org-constants";
import { isValidOrgSlug } from "@/server/services/agent-token";

/**
 * Strip port + IPv6 brackets from a `Host:` value.
 *
 *   "acme.vectorflow.sh:443"      -> "acme.vectorflow.sh"
 *   "[::1]:3000"                  -> "::1"
 *   "acme.vectorflow.sh"          -> "acme.vectorflow.sh"
 */
export function normalizeHost(host: string): string {
  let h = host.trim();
  if (h.startsWith("[")) {
    const close = h.indexOf("]");
    if (close > 0) return h.slice(1, close);
  }
  // Strip port if present. For IPv6 without brackets we'd be wrong, but
  // a `Host:` header without brackets is always either v4-or-name:port or
  // bare name; v6 is bracketed per RFC 7230.
  const colon = h.lastIndexOf(":");
  if (colon > 0) h = h.slice(0, colon);
  return h;
}

/**
 * Extract the candidate org slug from a normalised host. Returns null when
 * the host has fewer than two labels or the first label isn't a syntactically
 * valid slug. We require ≥2 labels so `localhost`, single-label intranet
 * names, and bare IPv4 literals never accidentally match an org slug.
 */
export function extractSlugFromHost(normalizedHost: string): string | null {
  const labels = normalizedHost.split(".");
  if (labels.length < 2) return null;
  const candidate = labels[0]?.toLowerCase();
  if (!candidate || !isValidOrgSlug(candidate)) return null;
  return candidate;
}

/**
 * In-process TTL cache for host→org resolution. Both positive (a real org)
 * and negative (`DEFAULT_ORG_ID`) results are cached so a custom-domain
 * request does not pay a DB round-trip on every call. The TTL is deliberately
 * short: it bounds how long a freshly-verified (or removed)
 * `OrganizationDomainClaim` takes to start (or stop) routing, and it is the
 * only staleness bound that holds across multiple server instances. Transient
 * DB errors are NOT cached (we fail open but retry on the next request).
 */
const HOST_ORG_CACHE_TTL_MS = 30_000;
/**
 * Hard cap on cache entries; the oldest are evicted first to bound memory when
 * unknown hosts (or abusive `Host:` headers) are probed.
 */
const HOST_ORG_CACHE_MAX = 1024;

const hostOrgCache = new Map<string, { orgId: string; expiresAt: number }>();

function getCachedOrgId(host: string): string | undefined {
  const hit = hostOrgCache.get(host);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    hostOrgCache.delete(host);
    return undefined;
  }
  return hit.orgId;
}

function setCachedOrgId(host: string, orgId: string): void {
  hostOrgCache.set(host, {
    orgId,
    expiresAt: Date.now() + HOST_ORG_CACHE_TTL_MS,
  });
  // Map preserves insertion order, so the first key is the oldest.
  while (hostOrgCache.size > HOST_ORG_CACHE_MAX) {
    const oldest = hostOrgCache.keys().next().value;
    if (oldest === undefined) break;
    hostOrgCache.delete(oldest);
  }
}

/**
 * Clear the host→org cache. Test-only: unit tests reset it between cases so a
 * cached entry from one case cannot mask the DB mock in the next.
 */
export function _resetHostOrgCacheForTests(): void {
  hostOrgCache.clear();
}

/**
 * Resolve an org id from an already normalised + lowercased host, hitting the
 * DB. Two paths, in PRECEDENCE order:
 *
 *   1. Custom-domain path: a *verified* `OrganizationDomainClaim`
 *      (`verifiedAt` not null) whose `domain` equals the FULL host (e.g.
 *      `logs.acme.com`). DNS-TXT ownership of the whole host is the strongest
 *      signal, so it MUST win over the slug path — otherwise a custom domain
 *      whose first label happens to collide with an existing org slug (e.g.
 *      `logs.acme.com` vs an org with slug `logs`) would misroute to the
 *      slug-org. A claim can only exist for a real custom domain (a tenant
 *      cannot set DNS-TXT on `*.vectorflow.sh`), so this never shadows a
 *      genuine `<orgSlug>.vectorflow.sh` subdomain.
 *   2. Subdomain path (the common case): if the first label is a syntactically
 *      valid slug, look up `Organization.slug`. Preserves the
 *      `<orgSlug>.vectorflow.sh` wildcard scheme exactly.
 *
 * No match in either path → `DEFAULT_ORG_ID`. Throws propagate so the caller
 * can fail open without caching a transient miss. The claim probe is an indexed
 * point query and the result is TTL-cached, so the common subdomain path pays
 * it only on a cold cache.
 */
async function resolveOrgIdFromHostUncached(
  normalizedHost: string,
): Promise<string> {
  // 1. Verified custom-domain claim on the full host wins (DNS-TXT ownership).
  //    Custom domains always carry at least one dot; skip the probe for
  //    single-label hosts (`localhost`) and bare IPs that can never own a claim.
  if (normalizedHost.includes(".")) {
    // `OrganizationDomainClaim.domain` is stored lowercase + punycode and
    // `Host:` values already arrive punycoded, so a lowercase compare matches.
    // `@@index([domain])` (+ the partial unique index on verified rows) make
    // this an indexed equality probe. Admin connection: runs pre-tenancy-scope.
    const claim = await adminPrisma.organizationDomainClaim.findFirst({
      where: { domain: normalizedHost, verifiedAt: { not: null } },
      select: { organizationId: true },
    });
    if (claim) return claim.organizationId;
  }
  // 2. Subdomain→org by slug (the `<orgSlug>.vectorflow.sh` hot path). Uses the
  //    admin connection (reads the fenced Organization table pre-tenancy-scope).
  const slug = extractSlugFromHost(normalizedHost);
  if (slug) {
    const org = await adminPrisma.organization.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (org) return org.id;
  }
  return DEFAULT_ORG_ID;
}

/**
 * Map a raw `Host:` header value to an organisation id. Returns
 * `DEFAULT_ORG_ID` for OSS hosts, missing hosts, slugs that don't exist, and
 * custom domains with no verified claim. This intentionally fails open to the
 * default org — cross-org leakage from the wrong direction (e.g. an attacker
 * spoofing a slug or `Host:` header) is prevented by RLS + per-org JWT
 * secrets, not by this lookup.
 *
 * Runtime boundary: this performs a DB read, so it MUST only be called from
 * the Node runtime. It is consumed by `src/auth.ts` (per-org NextAuth
 * instance + OIDC) and the SCIM auth layer, both Node. The edge middleware
 * `src/proxy.ts` deliberately does NOT call this — it stays on the
 * auth-gate/CSP path and never touches the DB — so custom domains are
 * resolved in the Node auth layer, never at the edge.
 */
export async function resolveOrgIdFromHost(
  host: string | null | undefined,
): Promise<string> {
  if (!host) return DEFAULT_ORG_ID;
  const normalizedHost = normalizeHost(host).toLowerCase();
  if (!normalizedHost) return DEFAULT_ORG_ID;
  const cached = getCachedOrgId(normalizedHost);
  if (cached !== undefined) return cached;
  try {
    const orgId = await resolveOrgIdFromHostUncached(normalizedHost);
    setCachedOrgId(normalizedHost, orgId);
    return orgId;
  } catch {
    // DB not reachable (build phase, migration in progress, etc.) — fail open
    // to OSS behaviour. Do NOT cache: a transient miss must not pin the host
    // to the default org for the full TTL.
    return DEFAULT_ORG_ID;
  }
}
