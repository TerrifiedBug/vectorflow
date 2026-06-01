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
 * Map a raw `Host:` header value to an organisation id. Returns
 * `DEFAULT_ORG_ID` for OSS hosts, missing hosts, or slugs that don't
 * exist in the DB. This intentionally fails open to the default org —
 * cross-org leakage from the wrong direction (e.g. an attacker spoofing
 * a slug) is prevented by RLS + per-org JWT secrets, not by this lookup.
 */
export async function resolveOrgIdFromHost(
  host: string | null | undefined,
): Promise<string> {
  if (!host) return DEFAULT_ORG_ID;
  const slug = extractSlugFromHost(normalizeHost(host));
  if (!slug) return DEFAULT_ORG_ID;
  try {
    // Subdomain→org resolution runs before any tenancy scope and reads the
    // (fenced) Organization table by slug, so it uses the admin connection.
    const org = await adminPrisma.organization.findUnique({
      where: { slug },
      select: { id: true },
    });
    return org?.id ?? DEFAULT_ORG_ID;
  } catch {
    // DB not reachable (build phase, migration in progress, etc.) —
    // OSS behaviour preserved.
    return DEFAULT_ORG_ID;
  }
}
