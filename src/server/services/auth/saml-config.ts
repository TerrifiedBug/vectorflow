/**
 * Per-organisation SAML SSO settings loader.
 *
 * Mirrors `getOidcSettings` in `src/auth.ts`:
 *   - The request host's first DNS label is matched against
 *     `Organization.slug`; each tenant sees only its own IdP. A session
 *     minted for org A can never be obtained through org B's IdP.
 *   - Hosts without an org-slug subdomain fall back to `DEFAULT_ORG_ID`
 *     so self-hosted (single-org) deployments behave unchanged.
 *   - Reads are RLS-fenced (`OrganizationSettings`), so they run inside
 *     `runWithOrgContext(orgId, …)` — these run PRE-AUTH (login page probing
 *     status, the SP login route) where there is no ambient org scope.
 *
 * This module deliberately does NOT import `@node-saml/node-saml`: it is
 * imported by `src/auth.ts` (the `samlEnforced` local-auth gate), and we keep
 * the XML/crypto library off that hot import path. The SAML library lives in
 * the sibling `saml.ts` service.
 *
 * `getSamlSettings` returns null unless SAML is BOTH enabled AND fully
 * configured (entityId + SSO URL + IdP certificate). That invariant means a
 * misconfigured org can never trip the `samlEnforced` gate and lock every
 * user out — enforcement requires a usable IdP first.
 */

import { isBuildPhase } from "@/lib/env";
import { getOrgSettings } from "@/lib/org-settings";
import { resolveOrgIdFromHost } from "@/lib/host-to-org";
import { runWithOrgContext } from "@/lib/org-context";
import { getRequestHostFromHeaders } from "@/lib/request-host";
import { headers } from "next/headers";

/** Default SAML attribute name carrying the user's group memberships. */
export const SAML_DEFAULT_GROUP_ATTRIBUTE = "groups";

export interface SamlSettings {
  organizationId: string;
  /** IdP EntityID — the expected `Issuer` of the SAML response/assertion. */
  idpEntityId: string;
  /** IdP Single-Sign-On URL — destination for the SP-initiated AuthnRequest. */
  ssoUrl: string;
  /** IdP public signing certificate (PEM or bare base64). Used to verify the
   *  response/assertion signature. A PUBLIC credential — never encrypted. */
  idpCert: string;
  /** When true (and the config is complete) local credential login is disabled. */
  enforced: boolean;
  /** Assertion attribute name holding group names for team reconciliation,
   *  or null when group→team sync is not configured for this org. */
  groupAttribute: string | null;
}

/**
 * Load and validate SAML settings for the org owning the incoming request
 * (or `orgIdOverride` when the caller already resolved the org from the
 * request). Returns null during the build phase, when SAML is disabled, or
 * when any required IdP field is missing.
 */
export async function getSamlSettings(
  orgIdOverride?: string,
): Promise<SamlSettings | null> {
  if (isBuildPhase) return null;

  try {
    let orgId = orgIdOverride;
    if (!orgId) {
      let host: string | null = null;
      try {
        host = getRequestHostFromHeaders(await headers());
      } catch {
        // headers() is unavailable outside a request scope — fall back below.
      }
      orgId = await resolveOrgIdFromHost(host);
    }

    return await runWithOrgContext(orgId, async () => {
      const settings = await getOrgSettings(orgId);
      if (
        !settings?.samlEnabled ||
        !settings.samlIdpEntityId ||
        !settings.samlIdpSsoUrl ||
        !settings.samlIdpCert
      ) {
        return null;
      }
      return {
        organizationId: orgId,
        idpEntityId: settings.samlIdpEntityId,
        ssoUrl: settings.samlIdpSsoUrl,
        idpCert: settings.samlIdpCert,
        enforced: settings.samlEnforced,
        groupAttribute: settings.samlGroupAttribute,
      };
    });
  } catch {
    // DB may be unavailable (e.g. during build) — treat as "no SAML".
    return null;
  }
}
