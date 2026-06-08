/**
 * Per-organisation SAML 2.0 SSO service (CL-3).
 *
 * Security model — all XML parsing and signature/crypto handling is delegated
 * to the maintained `@node-saml/node-saml` library. We NEVER hand-roll XML or
 * signature checks. The SP-initiated flow enforces, on the ACS response:
 *
 *   - signature: `wantAuthnResponseSigned` + `wantAssertionsSigned` are forced
 *     true and the response/assertion is verified against the org's configured
 *     IdP signing certificate (`samlIdpCert`). Unsigned or bad-signature
 *     responses are rejected.
 *   - audience: `audience` is pinned to our SP EntityID; an assertion whose
 *     `AudienceRestriction` does not list us is rejected.
 *   - replay / CSRF: `validateInResponseTo: always` requires every response to
 *     answer an AuthnRequest WE issued. The request id is bound to the browser
 *     via a single-use, encrypted state cookie, and the IdP-echoed `RelayState`
 *     nonce must match that cookie. IdP-initiated (unsolicited) responses are
 *     rejected.
 *   - expiry: NotBefore / NotOnOrAfter (and max assertion age) are enforced by
 *     the library with a small clock-skew tolerance.
 *
 * A SAML-authenticated session is minted through the SAME per-org JWT path
 * OIDC/credentials use — `encode()` from `next-auth/jwt` with the per-org
 * signing key (`getSessionSigningKey`) and the same claim shape
 * (`id`, `provider`, `org_id`, `authedAt`) — so the proxy gate and `auth()`
 * accept it identically to any other session. Group→team reconciliation reuses
 * the shared OIDC mapping mechanism (`reconcileUserTeamMemberships` over
 * `oidcTeamMappings`).
 */

import { SAML, generateServiceProviderMetadata, ValidateInResponseTo } from "@node-saml/node-saml";
import type { CacheProvider, Profile } from "@node-saml/node-saml";
import { encode, decode } from "next-auth/jwt";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { getOrgSettings } from "@/lib/org-settings";
import { withOrgTx } from "@/lib/with-org-tx";
import { runWithOrgContext } from "@/lib/org-context";
import { writeAuditLog } from "@/server/services/audit";
import { debugLog, warnLog } from "@/lib/logger";
import { getSessionSigningKey } from "@/server/services/auth/jwt-key";
import { reconcileUserTeamMemberships } from "@/server/services/group-mappings";
import { authConfig } from "@/auth.config";
import type { SamlSettings } from "@/server/services/auth/saml-config";

/** Login-page redirect target for any SAML failure (kept generic — details
 *  go to the audit log / server logs, never to the user-facing URL). */
export const SAML_LOGIN_ERROR_REDIRECT = "/login?error=saml";

/** Short-lived, single-use cookie binding the AuthnRequest id + RelayState
 *  nonce to the browser between `/login` and the ACS `/callback`. */
export const SAML_STATE_COOKIE = "vf-saml-state";
const SAML_STATE_MAX_AGE_S = 600; // 10 minutes to complete the round-trip.

/** Session lifetime — matches Auth.js's default JWT session maxAge so a
 *  SAML-minted cookie expires on the same schedule as an OIDC one. */
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

/** Tolerate modest IdP/SP clock drift on the NotBefore/NotOnOrAfter checks. */
const SAML_CLOCK_SKEW_MS = 60_000;

export interface SamlEndpoints {
  origin: string;
  secure: boolean;
  /** SP EntityID == our metadata URL; also the expected assertion Audience. */
  spEntityId: string;
  /** Assertion Consumer Service URL (the ACS / callback). */
  acsUrl: string;
}

interface SamlState {
  /** AuthnRequest id we issued — must equal the response's InResponseTo. */
  rid: string;
  /** Random RelayState nonce — must equal the IdP-echoed RelayState. */
  relay: string;
  /** Org the login was started for — re-checked against the host on callback. */
  org: string;
  /** Local post-login path. */
  returnTo: string;
}

/**
 * Derive this request's externally-visible SP endpoints. Behind a TLS-
 * terminating proxy the forwarded headers carry the real scheme/host, so the
 * SP EntityID/ACS match what the browser (and therefore the IdP) sees. Each
 * org subdomain yields its own EntityID/ACS, which is what the IdP registers.
 */
export function resolveSpEndpoints(request: Request): SamlEndpoints {
  const url = new URL(request.url);
  const fwdProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const fwdHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = fwdHost || request.headers.get("host") || url.host;
  const proto = fwdProto || url.protocol.replace(/:$/, "");
  const origin = `${proto}://${host}`;
  return {
    origin,
    secure: proto === "https",
    spEntityId: `${origin}/api/auth/saml/metadata`,
    acsUrl: `${origin}/api/auth/saml/callback`,
  };
}

/** Attributes for the single-use SAML state cookie. On HTTPS it MUST be
 *  `SameSite=None; Secure` so the browser sends it on the IdP's cross-site
 *  POST to our ACS; on plain HTTP (dev only) we degrade to Lax. */
export function samlStateCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? ("none" as const) : ("lax" as const),
    path: "/",
    maxAge: SAML_STATE_MAX_AGE_S,
  };
}

function buildSamlInstance(
  settings: SamlSettings,
  endpoints: SamlEndpoints,
  cacheProvider: CacheProvider,
): SAML {
  return new SAML({
    // SP identity (AuthnRequest issuer + expected assertion audience).
    issuer: endpoints.spEntityId,
    callbackUrl: endpoints.acsUrl,
    audience: endpoints.spEntityId,
    // IdP identity + trust anchor.
    entryPoint: settings.ssoUrl,
    idpCert: settings.idpCert,
    idpIssuer: settings.idpEntityId,
    // Hard security requirements — reject anything not fully signed by the
    // configured IdP cert, replayed, or unsolicited.
    wantAuthnResponseSigned: true,
    wantAssertionsSigned: true,
    validateInResponseTo: ValidateInResponseTo.always,
    acceptedClockSkewMs: SAML_CLOCK_SKEW_MS,
    cacheProvider,
  });
}

/** SP metadata XML describing this org's EntityID + ACS. Independent of the
 *  IdP config so it can be served before an admin pastes the IdP cert. */
export function generateSamlSpMetadata(endpoints: SamlEndpoints): string {
  return generateServiceProviderMetadata({
    issuer: endpoints.spEntityId,
    callbackUrl: endpoints.acsUrl,
    wantAssertionsSigned: true,
  });
}

function samlStateSecret(): string {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("SAML state cookie requires AUTH_SECRET / NEXTAUTH_SECRET");
  }
  return secret;
}

async function decodeSamlState(value: string | undefined): Promise<SamlState | null> {
  if (!value) return null;
  try {
    const decoded = await decode({
      salt: SAML_STATE_COOKIE,
      secret: samlStateSecret(),
      token: value,
    });
    if (
      !decoded ||
      typeof decoded.rid !== "string" ||
      typeof decoded.relay !== "string" ||
      typeof decoded.org !== "string" ||
      typeof decoded.returnTo !== "string"
    ) {
      return null;
    }
    return {
      rid: decoded.rid,
      relay: decoded.relay,
      org: decoded.org,
      returnTo: decoded.returnTo,
    };
  } catch {
    // Tampered/expired cookie — fail closed (no expected request id ⇒ the
    // InResponseTo check will reject the response anyway).
    return null;
  }
}

/**
 * Build the SP-initiated AuthnRequest redirect for an org and the encrypted
 * state cookie that binds the issued request id + RelayState nonce to the
 * browser. `returnTo` must already be a sanitised local path.
 */
export async function beginSamlLogin(
  settings: SamlSettings,
  endpoints: SamlEndpoints,
  returnTo: string,
): Promise<{ redirectUrl: string; stateCookieValue: string }> {
  // Capture the request id node-saml generates (saved via the cache provider
  // because validateInResponseTo !== never) so we can pin it in the cookie.
  let issuedRequestId: string | null = null;
  const captureCache: CacheProvider = {
    saveAsync: async (key, value) => {
      issuedRequestId = key;
      return { value, createdAt: Date.now() };
    },
    getAsync: async () => null,
    removeAsync: async () => null,
  };

  const relay = randomUUID();
  const saml = buildSamlInstance(settings, endpoints, captureCache);
  const redirectUrl = await saml.getAuthorizeUrlAsync(relay, undefined, {});
  if (!issuedRequestId) {
    throw new Error("SAML AuthnRequest id was not generated");
  }

  const stateCookieValue = await encode({
    salt: SAML_STATE_COOKIE,
    secret: samlStateSecret(),
    token: { rid: issuedRequestId, relay, org: settings.organizationId, returnTo },
    maxAge: SAML_STATE_MAX_AGE_S,
  });
  return { redirectUrl, stateCookieValue };
}

/**
 * Signature/audience/expiry/InResponseTo validation of an ACS POST. Throws if
 * the response is unsigned, badly signed, has the wrong audience, is expired,
 * or its InResponseTo does not match `expectedRequestId`. The expected id is
 * accepted by the cache provider for exactly this single request id, so a
 * replayed response (or one we never solicited) is rejected.
 */
export async function validateSamlResponse(
  settings: SamlSettings,
  endpoints: SamlEndpoints,
  samlResponse: string,
  expectedRequestId: string | null,
): Promise<Profile> {
  const expectCache: CacheProvider = {
    saveAsync: async (key, value) => ({ value, createdAt: Date.now() }),
    getAsync: async (key) =>
      expectedRequestId && key === expectedRequestId ? String(Date.now()) : null,
    removeAsync: async () => null,
  };

  const saml = buildSamlInstance(settings, endpoints, expectCache);
  const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse });
  if (!profile) {
    throw new Error("SAML response did not yield a profile");
  }
  return profile;
}

/**
 * Resolve + CSRF-check the state cookie against the IdP-echoed RelayState and
 * the host-resolved org. Returns the validated state or null (caller rejects).
 */
export async function consumeSamlState(
  cookieValue: string | undefined,
  relayStateFromForm: string | null,
  orgId: string,
): Promise<SamlState | null> {
  const state = await decodeSamlState(cookieValue);
  if (!state) return null;
  if (state.org !== orgId) return null;
  if (!relayStateFromForm || relayStateFromForm !== state.relay) return null;
  return state;
}

/** First email-shaped value among the standard profile fields. */
export function extractSamlEmail(profile: Profile): string | null {
  for (const candidate of [profile.email, profile.mail, profile.nameID]) {
    if (typeof candidate === "string" && candidate.includes("@")) {
      return candidate.trim().toLowerCase();
    }
  }
  return null;
}

/** Group names from the configured assertion attribute, normalised to a
 *  deduped string list (single value, multi-value array, or attributes map). */
export function extractSamlGroups(profile: Profile, attribute: string): string[] {
  const attrs = profile.attributes as Record<string, unknown> | undefined;
  const raw = (profile as Record<string, unknown>)[attribute] ?? attrs?.[attribute];
  if (raw == null) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return [...new Set(values.map((v) => String(v).trim()).filter(Boolean))];
}

export type SamlProvisionResult =
  | { userId: string }
  | { errorRedirect: string };

/**
 * Provision/link the SAML user and reconcile team memberships. Mirrors the
 * OIDC `signIn` callback in `src/auth.ts`:
 *   - auto-creates the user with `authMethod: "OIDC"` (the codebase-wide
 *     external-SSO marker keyed off by the UI, 2FA, and password-reset gates;
 *     a dedicated SAML enum value would need an `AuthMethod` migration, which
 *     the additive OrganizationSettings migration deliberately avoids);
 *   - refuses to link onto an existing NON-SSO (LOCAL / MAGIC_LINK) account —
 *     an admin must link it explicitly, never via implicit email collision;
 *   - reconciles team memberships from the group attribute via the shared
 *     `oidcTeamMappings` mechanism, unioning SCIM groups when SCIM is enabled,
 *     and falls back to the shared default team.
 * Runs inside the org RLS context so fenced reads/writes see this org's rows.
 */
export async function provisionSamlUser(
  orgId: string,
  settings: SamlSettings,
  profile: Profile,
  ipAddress: string | null,
): Promise<SamlProvisionResult> {
  return runWithOrgContext(orgId, async () => {
    const email = extractSamlEmail(profile);
    if (!email) {
      warnLog("saml", "SAML assertion carried no email/nameID — cannot provision.");
      return { errorRedirect: SAML_LOGIN_ERROR_REDIRECT };
    }
    const name =
      (typeof profile.displayName === "string" && profile.displayName) ||
      (typeof profile.cn === "string" && profile.cn) ||
      email.split("@")[0];

    let dbUser = await prisma.user.findUnique({ where: { email } });
    if (!dbUser) {
      dbUser = await prisma.user.create({
        data: { email, name, authMethod: "OIDC" },
      });
      writeAuditLog({
        organizationId: orgId, userId: dbUser.id, action: "auth.user_provisioned",
        entityType: "Auth", entityId: "saml", ipAddress, userEmail: email, userName: name,
      }).catch(() => {});
    } else if (dbUser.authMethod && dbUser.authMethod !== "OIDC") {
      writeAuditLog({
        organizationId: orgId, userId: dbUser.id, action: "auth.saml_link_blocked",
        entityType: "Auth", entityId: "saml", ipAddress, userEmail: dbUser.email, userName: dbUser.name,
        metadata: { reason: "non_sso_account_exists", existingAuthMethod: dbUser.authMethod },
      }).catch(() => {});
      warnLog("saml", `SAML login blocked: existing account uses ${dbUser.authMethod} for ${dbUser.email}. Admin must link accounts explicitly.`);
      return { errorRedirect: "/login?error=local_account" };
    }

    if (settings.groupAttribute) {
      const tokenGroups = extractSamlGroups(profile, settings.groupAttribute);
      debugLog("saml", `User ${email} groups (attr "${settings.groupAttribute}"):`, tokenGroups);
      const orgSettings = await getOrgSettings(orgId);

      let userGroupNames = tokenGroups;
      if (orgSettings.scimEnabled) {
        // SCIM+SAML: union of provisioned ScimGroupMember groups + assertion
        // groups (SAML does not write ScimGroupMember). Mirrors OIDC.
        const scimGroups = await prisma.scimGroupMember.findMany({
          where: { userId: dbUser.id },
          include: { scimGroup: { select: { displayName: true } } },
        });
        userGroupNames = [
          ...new Set([...scimGroups.map((g) => g.scimGroup.displayName), ...tokenGroups]),
        ];
      }

      const userId = dbUser.id;
      await withOrgTx(orgId, async (tx) => {
        await reconcileUserTeamMemberships(tx, userId, userGroupNames, orgId);
      });

      // Shared default-team fallback (reuses the OIDC default-team config).
      if (orgSettings.oidcDefaultTeamId) {
        const hasMembership = await prisma.teamMember.findFirst({ where: { userId } });
        if (!hasMembership) {
          await prisma.teamMember.upsert({
            where: { userId_teamId: { userId, teamId: orgSettings.oidcDefaultTeamId } },
            create: {
              userId,
              teamId: orgSettings.oidcDefaultTeamId,
              role: orgSettings.oidcDefaultRole ?? "VIEWER",
              source: "group_mapping",
            },
            update: {},
          });
        }
      }
    }

    writeAuditLog({
      organizationId: orgId, userId: dbUser.id, action: "auth.login_success",
      entityType: "Auth", entityId: "saml", ipAddress, userEmail: dbUser.email, userName: dbUser.name,
    }).catch(() => {});
    return { userId: dbUser.id };
  });
}

interface SessionCookieSpec {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: "lax";
    path: "/";
    secure: boolean;
    maxAge: number;
  };
}

/**
 * Mint the NextAuth session cookie for a SAML-authenticated user. Uses the
 * same per-org signing key, cookie name (strict `__Host-` override or the
 * Auth.js default for the connection), and claim shape as the OIDC/credentials
 * path, so the proxy gate and `auth()` validate it identically.
 */
export async function buildSamlSessionCookie(params: {
  orgId: string;
  userId: string;
  name: string | null;
  email: string;
  secure: boolean;
}): Promise<SessionCookieSpec> {
  const overrideName = authConfig.cookies?.sessionToken?.name;
  const name =
    overrideName ??
    (params.secure ? "__Secure-authjs.session-token" : "authjs.session-token");
  const secret = await getSessionSigningKey(params.orgId);
  const value = await encode({
    salt: name,
    secret,
    maxAge: SESSION_MAX_AGE_S,
    token: {
      id: params.userId,
      sub: params.userId,
      name: params.name,
      email: params.email,
      picture: null,
      provider: "saml",
      org_id: params.orgId,
      authedAt: Date.now(),
    },
  });
  return {
    name,
    value,
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: params.secure || name.startsWith("__Secure-") || name.startsWith("__Host-"),
      maxAge: SESSION_MAX_AGE_S,
    },
  };
}

/** Ensure a post-login redirect target stays on this origin (no open redirect). */
export function sanitizeReturnTo(raw: string | null | undefined): string {
  // Must be a relative path. Resolve against a sentinel origin and confirm it
  // did NOT escape to a foreign origin: the WHATWG URL parser folds backslashes
  // and strips tab/newline for http(s), so prefix checks like `!startsWith("//")`
  // are bypassable (e.g. "/\\evil.com" -> https://evil.com/). Compare origins.
  if (typeof raw !== "string" || !raw.startsWith("/")) return "/";
  try {
    const base = "https://sp.invalid";
    const u = new URL(raw, base);
    if (u.origin !== base) return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}
