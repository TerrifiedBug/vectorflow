/**
 * WebAuthn / passkey NextAuth provider (plan §8 / §16b OSS-8).
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
 *   - `expectedOrigin` is the request's origin header. For Cloud,
 *     subdomain origins (`acme.vectorflow.sh`) MUST be accepted; the
 *     `expectedOrigin` parameter takes a list, so we resolve from the
 *     `VF_WEBAUTHN_ORIGINS` comma-separated env or, when unset, the
 *     request's own `Origin` header.
 */

import Credentials from "next-auth/providers/credentials";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

import { prisma } from "@/lib/prisma";
import { finishAuthentication } from "@/server/services/webauthn";
import { writeAuditLog } from "@/server/services/audit";
import { warnLog, infoLog } from "@/lib/logger";

const RP_ID = process.env.VF_WEBAUTHN_RP_ID ?? "localhost";
const RP_NAME = process.env.VF_WEBAUTHN_RP_NAME ?? "VectorFlow";

/**
 * Resolve the set of acceptable origins. Cloud builds set
 * `VF_WEBAUTHN_ORIGINS=https://app.vectorflow.sh,https://*.vectorflow.sh`
 * (comma-separated) so subdomain redirects are honoured.
 */
function expectedOrigins(): string | string[] {
  const env = process.env.VF_WEBAUTHN_ORIGINS;
  if (!env) {
    // OSS / dev fallback: accept localhost on common dev ports.
    return [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:3001",
    ];
  }
  return env
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
      select: { id: true, email: true, name: true, image: true, lockedAt: true },
    });
    if (!user) {
      warnLog(
        "webauthn-provider",
        `assertion verified for unknown user id ${result.userId}`,
      );
      return null;
    }
    if (user.lockedAt) {
      warnLog(
        "webauthn-provider",
        `assertion verified but user ${user.id} is locked; denying`,
      );
      return null;
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
