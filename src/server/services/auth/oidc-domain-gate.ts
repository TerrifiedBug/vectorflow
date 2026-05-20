/**
 * Audit gap C.4 — refuse `settings.updateOidc` writes unless the
 * calling org has a *verified* `OrganizationDomainClaim` whose domain
 * matches the OIDC issuer's hostname.
 *
 * Why: PR #375 shipped the domain-claim primitive (DNS-TXT verified,
 * `verifiedAt` populated on success). The audit found that the
 * `settings.updateOidc` mutation never consulted it — any org admin
 * could point their IdP at any issuer host (e.g. an attacker's). With
 * this gate the mutation becomes:
 *
 *   1. Parse issuer URL → extract hostname.
 *   2. Match hostname against the org's verified `OrganizationDomainClaim`
 *      rows. Exact match OR claim's domain is a parent of the hostname
 *      (i.e. hostname ends with `.<claim.domain>`) is accepted.
 *   3. Any other shape — no verified claim, claim owned by another org,
 *      hostname parse failure — is rejected.
 *
 * The gate is **strict** (refuse on miss). There is no soft-fallback
 * and no auto-claim. Operators may extend the gate later to allow
 * shared-IdP hostnames (e.g. `accounts.google.com`) behind an opt-in
 * `OrganizationSettings` flag; that flag is intentionally NOT shipped
 * by default — see Lane 4 in
 * `local://saas-launch-close-audit-gaps.md`.
 */

import type { PrismaClient } from "@/generated/prisma";
import { normaliseDomain } from "./domain-claim";

/** Result returned by {@link assertVerifiedDomainForIssuer}. */
export type OidcDomainGateResult =
  | { ok: true; matchedClaimId: string; matchedDomain: string }
  | { ok: false; reason: string };

/**
 * Extract the lowercase ASCII hostname from an issuer URL.
 * Returns `null` if the URL is unparseable or has no hostname.
 *
 * Exported so {@link assertVerifiedDomainForIssuer} and the tests can
 * share one implementation.
 */
export function extractIssuerHostname(issuerUrl: string): string | null {
  try {
    const url = new URL(issuerUrl);
    const host = url.hostname.trim().toLowerCase();
    if (!host) return null;
    // Strip the trailing dot if present so we compare canonical FQDNs.
    return host.endsWith(".") ? host.slice(0, -1) : host;
  } catch {
    return null;
  }
}

/**
 * `true` iff `hostname` is `claimDomain` or a subdomain of `claimDomain`.
 *
 * Both sides are expected to be already-normalised (lowercase ASCII,
 * no trailing dot). Pure string compare — no DNS lookup.
 */
export function hostnameMatchesClaimDomain(
  hostname: string,
  claimDomain: string,
): boolean {
  if (!hostname || !claimDomain) return false;
  if (hostname === claimDomain) return true;
  // Subdomain match — must end with `.<claim>` so that `evilacme.com`
  // does not match a claim on `acme.com`.
  return hostname.endsWith(`.${claimDomain}`);
}

/**
 * Assert that `organizationId` holds a verified `OrganizationDomainClaim`
 * whose domain matches the issuer URL's hostname.
 *
 * Resolves with `{ ok: true, matchedClaimId, matchedDomain }` on
 * success, or `{ ok: false, reason }` with a human-readable
 * explanation suitable for surfacing in a `PRECONDITION_FAILED`
 * TRPCError message.
 */
export async function assertVerifiedDomainForIssuer(args: {
  prisma: PrismaClient;
  organizationId: string;
  issuerUrl: string;
}): Promise<OidcDomainGateResult> {
  const hostname = extractIssuerHostname(args.issuerUrl);
  if (!hostname) {
    return {
      ok: false,
      reason:
        "OIDC issuer must be a valid URL with a hostname. Configure a fully qualified discovery endpoint (e.g. `https://login.example.com/oauth2`).",
    };
  }

  // Normalise through the same canonicaliser used when domains are
  // claimed so we compare apples to apples. We accept punycode failures
  // here (an issuer hostname that fails this check is unusable as an
  // IdP anyway).
  let normalisedHost: string;
  try {
    normalisedHost = normaliseDomain(hostname);
  } catch {
    return {
      ok: false,
      reason:
        "OIDC issuer hostname failed DNS-name normalisation. Check the issuer URL is a real fully qualified domain.",
    };
  }

  const verifiedClaims = await args.prisma.organizationDomainClaim.findMany({
    where: {
      organizationId: args.organizationId,
      verifiedAt: { not: null },
    },
    select: { id: true, domain: true },
  });

  if (verifiedClaims.length === 0) {
    return {
      ok: false,
      reason:
        "OIDC configuration requires a verified domain claim. Claim and verify the IdP's domain under Settings → Auth → Domain claims before saving OIDC settings.",
    };
  }

  for (const claim of verifiedClaims) {
    if (hostnameMatchesClaimDomain(normalisedHost, claim.domain)) {
      return { ok: true, matchedClaimId: claim.id, matchedDomain: claim.domain };
    }
  }

  return {
    ok: false,
    reason: `OIDC issuer hostname \`${normalisedHost}\` is not covered by any verified domain claim for this organization. Claim and verify a parent domain (e.g. the IdP's apex) before saving OIDC settings.`,
  };
}
