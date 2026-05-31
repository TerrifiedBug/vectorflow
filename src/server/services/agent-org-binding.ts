/**
 * Resolves the Organization context for an incoming agent request.
 *
 * Enforces the two-knob agent tenant isolation from the threat model:
 *   1. Per-org hostname: ingress injects X-VF-Org-Slug from the subdomain.
 *   2. Slug-prefixed token: the token itself embeds the org slug.
 *
 * Both must agree when present. A mismatch is a cross-tenant attempt and
 * returns 401 (not 403 — don't leak whether the org exists).
 *
 * For self-hosted / OSS deployments there is no subdomain routing and no
 * X-VF-Org-Slug header. The function falls back to DEFAULT_ORG_SLUG/ID
 * transparently so existing agents require no changes.
 */

import { adminPrisma } from "@/lib/prisma";
import { DEFAULT_ORG_ID, DEFAULT_ORG_SLUG } from "@/lib/org-constants";
import { extractBearerToken, parseTokenSlug, isLegacyNodeToken, isLegacyEnrollmentToken } from "./agent-token";
import { warnLog } from "@/lib/logger";

export interface AgentOrgContext {
  orgId: string;
  orgSlug: string;
  /** True when the request carries a legacy (pre-slug) token. */
  isLegacyToken: boolean;
}

/**
 * Resolve the Organization for an agent request.
 *
 * Returns an AgentOrgContext on success, or a ready-to-return Response on
 * failure (401 Unauthorized or 503 Service Unavailable for suspended orgs).
 *
 * Call pattern in route handlers:
 * ```ts
 * const orgResult = await resolveAgentOrg(request);
 * if (orgResult instanceof Response) return orgResult;
 * const agent = await authenticateAgentInOrg(request, orgResult.orgId);
 * ```
 */
export async function resolveAgentOrg(
  request: Request,
  opts?: {
    /**
     * Override the token used for slug/legacy detection.
     * Use this when the agent token is in the request body rather than the
     * Authorization header (i.e. the enrollment route).
     */
    explicitToken?: string;
  },
): Promise<AgentOrgContext | Response> {
  // X-VF-Org-Slug is the ingress-supplied subdomain marker. It is set by
  // a multi-tenant ingress after stripping the raw Host header; OSS /
  // self-hosted deployments never set this header.
  //
  // ⚠️  DEPLOYMENT REQUIREMENT (strict-multi-tenant): the ingress MUST
  // strip any client-supplied X-VF-Org-Slug before injecting its own
  // value derived from the authenticated subdomain. If this header can
  // be set by agents, the hostname-based isolation knob is degraded to
  // a no-op and the system falls back to single-factor auth (token
  // only). The DB-layer org scope in authenticateAgentInOrg still
  // prevents cross-tenant data access, but the defense-in-depth
  // property is lost.
  const headerSlug = request.headers.get("x-vf-org-slug");

  const token = opts?.explicitToken
    ?? extractBearerToken(request.headers.get("authorization"));
  const tokenSlug = token ? parseTokenSlug(token) : null;
  const isLegacy = token
    ? isLegacyNodeToken(token) || isLegacyEnrollmentToken(token)
    : false;

  // ── Subdomain-bound path: ingress provided a slug header ───────────────
  if (headerSlug) {
    if (tokenSlug && tokenSlug !== headerSlug) {
      // Token claims a different org than the subdomain it arrived on.
      // This is either a cross-tenant replay attempt or a misconfigured agent.
      warnLog(
        "agent-org",
        `cross-tenant slug mismatch: header=${headerSlug} token=${tokenSlug}`,
      );
      return new Response("Unauthorized", { status: 401 });
    }

    // Legacy tokens on a non-default subdomain are rejected: they have
    // no embedded slug so we can't verify they belong to this org.
    if (isLegacy && headerSlug !== DEFAULT_ORG_SLUG) {
      warnLog(
        "agent-org",
        `legacy token rejected on non-default subdomain slug=${headerSlug}`,
      );
      return new Response("Unauthorized", { status: 401 });
    }

    // Fast path: default org never needs a DB lookup.
    if (headerSlug === DEFAULT_ORG_SLUG) {
      return { orgId: DEFAULT_ORG_ID, orgSlug: DEFAULT_ORG_SLUG, isLegacyToken: isLegacy };
    }

    // Tokenless requests on a non-default subdomain cannot be attributed
    // to any org identity — reject early before touching the DB.
    if (!token) {
      return new Response("Unauthorized", { status: 401 });
    }

    return lookupOrg(headerSlug, isLegacy);
  }

  // ── OSS / self-hosted path: no subdomain header ──────────────────────────
  // Use the slug embedded in the token, or DEFAULT_ORG_SLUG for legacy tokens.
  const slug = tokenSlug ?? DEFAULT_ORG_SLUG;

  if (slug === DEFAULT_ORG_SLUG) {
    if (isLegacy) {
      warnLog(
        "agent-org",
        "legacy token without slug — consider regenerating via enroll",
      );
    }
    return { orgId: DEFAULT_ORG_ID, orgSlug: DEFAULT_ORG_SLUG, isLegacyToken: isLegacy };
  }

  return lookupOrg(slug, isLegacy);
}

async function lookupOrg(
  slug: string,
  isLegacy: boolean,
): Promise<AgentOrgContext | Response> {
  // Pre-context org resolution by slug against the (fenced) Organization
  // table — runs on the admin connection before runWithOrgContext is set.
  const org = await adminPrisma.organization.findUnique({
    where: { slug },
    select: { id: true, slug: true, suspendedAt: true, deletedAt: true },
  });

  if (!org || org.deletedAt) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (org.suspendedAt) {
    return new Response(
      JSON.stringify({ error: "Organization suspended" }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "86400",
        },
      },
    );
  }

  return { orgId: org.id, orgSlug: org.slug, isLegacyToken: isLegacy };
}
