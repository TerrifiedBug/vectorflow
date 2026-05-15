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

import { prisma } from "@/lib/prisma";
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
): Promise<AgentOrgContext | Response> {
  // X-VF-Org-Slug is injected by the Cloud ingress after stripping the raw
  // Host header. Self-hosted deployments never set this header.
  const headerSlug = request.headers.get("x-vf-org-slug");

  const token = extractBearerToken(request.headers.get("authorization"));
  const tokenSlug = token ? parseTokenSlug(token) : null;
  const isLegacy = token
    ? isLegacyNodeToken(token) || isLegacyEnrollmentToken(token)
    : false;

  // ── Cloud path: ingress provided a slug header ──────────────────────────
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

    // Legacy tokens on a non-default subdomain are rejected in Cloud.
    // They have no embedded slug so we can't verify they belong to this org.
    if (isLegacy && headerSlug !== DEFAULT_ORG_SLUG) {
      warnLog(
        "agent-org",
        `legacy token rejected on cloud subdomain slug=${headerSlug}`,
      );
      return new Response("Unauthorized", { status: 401 });
    }

    // Fast path: default org never needs a DB lookup.
    if (headerSlug === DEFAULT_ORG_SLUG) {
      return { orgId: DEFAULT_ORG_ID, orgSlug: DEFAULT_ORG_SLUG, isLegacyToken: isLegacy };
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
  const org = await prisma.organization.findUnique({
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
