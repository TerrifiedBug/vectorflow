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
 * The gate is **strict by default** (refuse on miss). Operators MAY
 * relax the gate per-org by setting
 * `OrganizationSettings.allowSharedIdpHostnames = true` (passed in as
 * `allowSharedHostnames`). When relaxed, the issuer URL must still
 * parse and normalise to a valid hostname but no claim lookup is
 * performed — the result reports `matchedClaimId: "__operator_bypass__"`
 * so callers can distinguish the two acceptance paths. The flag is
 * intentionally NOT customer-toggleable: a self-serve switch would
 * re-introduce the very attack the gate closed (an admin pointing
 * their IdP at an attacker-controlled discovery endpoint).
 */

import { normaliseDomain } from "./domain-claim";

/** Result returned by {@link assertVerifiedDomainForIssuer}. */
export type OidcDomainGateResult =
  | { ok: true; matchedClaimId: string; matchedDomain: string }
  | { ok: false; reason: string };

/**
 * Sentinel `matchedClaimId` returned when the operator-controlled
 * `allowSharedIdpHostnames` flag was the reason the gate accepted the
 * issuer (i.e. no `OrganizationDomainClaim` was consulted). Audit
 * logs and downstream consumers MAY key off this sentinel to record
 * "accepted via operator bypass" instead of attributing the decision
 * to a non-existent claim row.
 */
export const OPERATOR_BYPASS_CLAIM_ID = "__operator_bypass__";

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
  prisma: {
    organizationDomainClaim: {
      findMany: (a: {
        where: { organizationId: string; verifiedAt: { not: null } };
        select: { id: true; domain: true };
      }) => Promise<Array<{ id: string; domain: string }>>;
    };
  };
  organizationId: string;
  issuerUrl: string;
  /**
   * When `true`, skip the verified-claim lookup and accept any
   * parseable issuer URL. Wired through from
   * `OrganizationSettings.allowSharedIdpHostnames`; operator-controlled.
   */
  allowSharedHostnames?: boolean;
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

  // Claim lookup runs first so that an org with both
  // `allowSharedHostnames` AND a verified matching claim attributes the
  // acceptance to the claim (audit logs show the specific claim id, not
  // the bypass sentinel). The bypass falls in below as the last resort.
  const verifiedClaims = await args.prisma.organizationDomainClaim.findMany({
    where: {
      organizationId: args.organizationId,
      verifiedAt: { not: null },
    },
    select: { id: true, domain: true },
  });

  for (const claim of verifiedClaims) {
    if (hostnameMatchesClaimDomain(normalisedHost, claim.domain)) {
      return { ok: true, matchedClaimId: claim.id, matchedDomain: claim.domain };
    }
  }

  // Operator-only escape hatch (PR #377). The URL has already parsed
  // and normalised, so we know the issuer is at least syntactically
  // valid — refuse the malformed-URL inputs above. With the flag set,
  // no verified claim is required.
  if (args.allowSharedHostnames) {
    return {
      ok: true,
      matchedClaimId: OPERATOR_BYPASS_CLAIM_ID,
      matchedDomain: normalisedHost,
    };
  }

  if (verifiedClaims.length === 0) {
    return {
      ok: false,
      reason:
        "OIDC configuration requires a verified domain claim. Claim and verify the IdP's domain under Settings → Auth → Domain claims before saving OIDC settings.",
    };
  }

  return {
    ok: false,
    reason: `OIDC issuer hostname \`${normalisedHost}\` is not covered by any verified domain claim for this organization. Claim and verify a parent domain (e.g. the IdP's apex) before saving OIDC settings.`,
  };
}
