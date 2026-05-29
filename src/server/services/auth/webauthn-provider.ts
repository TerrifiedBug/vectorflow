/**
 * WebAuthn / passkey NextAuth provider..
 *
 * Wraps `@/server/services/webauthn`'s `finishAuthentication` in a
 * Credentials-style provider so `signIn("webauthn", { ... })` works on
 * the browser side after a `navigator.credentials.get()` call.
 *
 * Flow:
 *
 *   1. Browser POSTs to `/api/auth/webauthn/options` → server returns
 *      `PublicKeyCredentialRequestOptionsJSON` + persists the challenge.
 *   2. Browser invokes `navigator.credentials.get(options)` → assertion.
 *   3. Browser calls `signIn("webauthn", { assertionJSON: JSON.stringify(asr) })`.
 *   4. Provider calls `finishAuthentication`, looks up the User by id,
 *      and returns the NextAuth user object.
 *
 * Replay defence is handled inside `finishAuthentication` (challenge
 * single-use + counter monotonicity); the provider only mediates.
 *
 * RpID / origin:
 *   - `rpID` defaults to the platform apex (e.g. `vectorflow.sh`) read
 *     from `VF_WEBAUTHN_RP_ID`. OSS / dev defaults to `localhost`.
 *   - `expectedOrigin` is the request's origin header. Under multi-tenant,
 *     subdomain origins (`acme.vectorflow.sh`) MUST be accepted; the
 *     `expectedOrigin` parameter takes a list, so we resolve from the
 *     `VF_WEBAUTHN_ORIGINS` comma-separated env or, when unset, the
 *     request's own `Origin` header.
 */

import Credentials from "next-auth/providers/credentials";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

import { prisma } from "@/lib/prisma";
import { isBuildPhase } from "@/lib/env";
import { finishAuthentication } from "@/server/services/webauthn";
import { writeAuditLog } from "@/server/services/audit";
import { warnLog, infoLog } from "@/lib/logger";
import { getRemainingLockSeconds } from "@/server/services/login-protection";

const RP_ID = process.env.VF_WEBAUTHN_RP_ID ?? "localhost";
const RP_NAME = process.env.VF_WEBAUTHN_RP_NAME ?? "VectorFlow";

// Fail loudly at module load in production so a misconfigured stamp is caught
// on startup, not on the first user sign-in attempt. An attacker who reaches
// the server via the loopback (side-channel or mis-routed traffic) could
// otherwise complete a WebAuthn ceremony bound to localhost.
//
// Exempt the `next build` phase: server modules are statically imported for
// page-data collection under NODE_ENV=production but without runtime env, so
// VF_WEBAUTHN_RP_ID is legitimately absent then. The guard still fires at real
// runtime startup. Mirrors the VF_ENCRYPTION_KEY_V2 build-phase skip in env.ts.
if (
  !isBuildPhase &&
  process.env.NODE_ENV === "production" &&
  !process.env.VF_WEBAUTHN_RP_ID
) {
  throw new Error(
    "[webauthn-provider] VF_WEBAUTHN_RP_ID must be set in production. " +
      "WebAuthn refuses the localhost fallback to prevent credential acceptance " +
      "via loopback access. Set VF_WEBAUTHN_RP_ID to your platform domain.",
  );
}

/**
 * Resolve the set of acceptable origins. Multi-subdomain deployments
 * set `VF_WEBAUTHN_ORIGINS=https://app.example.com,https://*.example.com`
 * (comma-separated) so subdomain redirects are honoured.
 *
 * When `VF_WEBAUTHN_ORIGINS` is not set, the function falls back to the
 * origin derived from `VF_WEBAUTHN_RP_ID`. Single-tenant deployments
 * that set `VF_WEBAUTHN_RP_ID=example.com` get `https://example.com`
 * automatically, without needing a separate `VF_WEBAUTHN_ORIGINS` variable.
 */
function expectedOrigins(): string | string[] {
  const env = process.env.VF_WEBAUTHN_ORIGINS;
  if (env) {
    return env
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // Derive origin from VF_WEBAUTHN_RP_ID when it is set to a non-localhost
  // domain. Covers self-hosted OSS without requiring a separate env var.
  const rpId = process.env.VF_WEBAUTHN_RP_ID;
  if (rpId && rpId !== "localhost") {
    return [`https://${rpId}`, `http://${rpId}`];
  }
  // Dev / OSS fallback: accept localhost on common dev ports.
  // Production is guarded at module-init (throw above), so this branch
  // is unreachable when NODE_ENV=production.
  return [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
  ];
}

/**
 * Pure authorize function extracted from the `Credentials({...})` call
 * so unit tests can exercise it without going through next-auth's
 * wrapping. Exported for that reason; production code paths reach for
 * `webauthnProvider` and never touch this directly.
 */
export async function authorizeWebauthn(
  credentials: Record<string, unknown> | undefined,
): Promise<{
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
} | null> {
  if (!credentials || typeof credentials.assertionJSON !== "string") {
    return null;
  }
  // Honour operator SSO-only policy — disable all local auth paths including WebAuthn.
  if (process.env.VF_DISABLE_LOCAL_AUTH === "true") {
    warnLog("webauthn-provider", "VF_DISABLE_LOCAL_AUTH is set; denying WebAuthn login");
    return null;
  }

  let assertion: AuthenticationResponseJSON;
  try {
    assertion = JSON.parse(credentials.assertionJSON) as AuthenticationResponseJSON;
  } catch (err) {
    warnLog("webauthn-provider", "invalid assertion JSON", err);
    return null;
  }

  try {
    const result = await finishAuthentication({
      rp: {
        rpName: RP_NAME,
        rpID: RP_ID,
        expectedOrigin: expectedOrigins(),
      },
      response: assertion,
    });

    const user = await prisma.user.findUnique({
      where: { id: result.userId },
      select: { id: true, email: true, name: true, image: true, lockedAt: true, lockedBy: true },
    });
    if (!user) {
      warnLog(
        "webauthn-provider",
        `assertion verified for unknown user id ${result.userId}`,
      );
      return null;
    }
    if (user.lockedAt) {
      // Brute-force locks are temporary; check whether they have expired before
      // denying permanently. Admin-imposed locks (lockedBy !== "brute_force")
      // never auto-expire and getRemainingLockSeconds returns Infinity.
      const remaining = getRemainingLockSeconds(user.lockedAt, user.lockedBy ?? null);
      if (remaining > 0) {
        warnLog(
          "webauthn-provider",
          `assertion verified but user ${user.id} is locked (${remaining}s remaining); denying`,
        );
        return null;
      }
      // Lock expired — clear the stale lock fields so the account
      // is no longer represented as locked in SCIM, admin UI, and
      // other flows that key off `lockedAt`.
      prisma.user
        .update({
          where: { id: user.id },
          data: { lockedAt: null, lockedBy: null },
        })
        .catch(() => undefined);
      // Fall through and allow login.
    }

    writeAuditLog({
      userId: user.id,
      action: "auth.login_succeeded",
      entityType: "Auth",
      entityId: "webauthn",
      userEmail: user.email,
      userName: user.name,
      metadata: { credentialId: result.credentialId },
    }).catch(() => undefined);

    infoLog("webauthn-provider", `webauthn login: user ${user.id}`);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
    };
  } catch (err) {
    // finishAuthentication throws on replay / counter regression /
    // unknown credential / wrong-kind challenge. We deliberately do
    // NOT surface the exception text to the client; a generic null
    // return triggers the standard NextAuth credential-failure path.
    warnLog("webauthn-provider", "finishAuthentication failed", err);
    return null;
  }
}

/**
 * NextAuth Credentials-shaped provider. The browser passes the full
 * `AuthenticationResponseJSON` as a single `assertionJSON` field —
 * NextAuth's Credentials form is stringly-typed, so we serialise on
 * the client and parse on the server.
 */
export const webauthnProvider = Credentials({
  id: "webauthn",
  name: "Passkey",
  credentials: {
    assertionJSON: { label: "WebAuthn Assertion JSON", type: "text" },
  },
  authorize: authorizeWebauthn,
});
