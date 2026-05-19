/**
 * Per-subdomain `__Host-` cookie config.
 *
 * Cookie scoping decision: cookies are host-only (no `Domain=` attribute)
 * so an XSS on `acme.vectorflow.sh` does NOT leak a cookie that's valid
 * on `beta.vectorflow.sh`. The `__Host-` prefix enforces this at the
 * browser level — a cookie prefixed `__Host-` MUST:
 *
 *   - be `Secure`,
 *   - have NO `Domain=` attribute (host-only),
 *   - have `Path=/`.
 *
 * Browsers REJECT a `Set-Cookie` header that violates any of those.
 * That makes the prefix self-policing: a developer who accidentally
 * adds `Domain=.vectorflow.sh` to a `__Host-` cookie breaks the
 * sign-in flow immediately in dev — there's no quiet, intermittent
 * cross-subdomain bleed.
 *
 * OSS / dev profile keeps the NextAuth defaults (no prefix; `Secure`
 * set automatically based on the request scheme) so `http://localhost`
 * dev still works.
 *
 * The overlay can enable this by returning the override.
 */

import type { NextAuthConfig } from "next-auth";

const COOKIE_BASE_NAME = "vf";

/**
 * Returns the `cookies` override for `NextAuthConfig`, or `undefined`
 * to keep NextAuth defaults. Spread the result into `authConfig.cookies`
 * (or the per-instance NextAuth() construction).
 */
export function cloudCookieConfig(): NextAuthConfig["cookies"] | undefined {
  if (process.env.VF_STRICT_MULTI_TENANT !== "true") {
    return undefined;
  }
  const base = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: true,
    // NB: NO `domain` field — host-only is the point.
  };
  return {
    sessionToken: {
      name: `__Host-${COOKIE_BASE_NAME}-session`,
      options: base,
    },
    callbackUrl: {
      name: `__Host-${COOKIE_BASE_NAME}-callback-url`,
      options: base,
    },
    csrfToken: {
      // CSRF token uses `__Host-` like the others. NextAuth's default
      // `csrfToken` name has different conventions across versions;
      // we override to the consistent prefix.
      name: `__Host-${COOKIE_BASE_NAME}-csrf`,
      options: base,
    },
    pkceCodeVerifier: {
      name: `__Host-${COOKIE_BASE_NAME}-pkce`,
      options: { ...base, maxAge: 900 },
    },
    state: {
      name: `__Host-${COOKIE_BASE_NAME}-state`,
      options: { ...base, maxAge: 900 },
    },
    nonce: {
      name: `__Host-${COOKIE_BASE_NAME}-nonce`,
      options: base,
    },
  };
}

/**
 * Test-only sentinels so a smoke-test can assert the prefix is
 * present in every cookie name without re-running the construction
 * with a stubbed env.
 */
export const _cloudCookieInternals = {
  COOKIE_BASE_NAME,
};

/**
 * Cookie names that previous NextAuth releases set on this deployment
 * before the strict-multi-tenant profile migrated to `__Host-vf-*`.
 * Both v4 (`next-auth.*`) and v5 (`authjs.*`) families are listed in
 * their insecure and `__Secure-` / `__Host-` prefixed variants.
 *
 * Anyone who signed in before the cookie rename carries one of these
 * as an orphan: the new server reads `__Host-vf-session` and the
 * legacy cookie contributes nothing to authentication, but it widens
 * the surface that an XSS or stolen-laptop scenario can hit. We evict
 * them on the next response under strict-multi-tenant.
 */
const LEGACY_AUTH_COOKIE_NAMES: readonly string[] = [
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
  "next-auth.callback-url",
  "__Secure-next-auth.callback-url",
  "next-auth.csrf-token",
  "__Host-next-auth.csrf-token",
  "next-auth.pkce.code_verifier",
  "__Secure-next-auth.pkce.code_verifier",
  "next-auth.state",
  "__Secure-next-auth.state",
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "authjs.callback-url",
  "__Secure-authjs.callback-url",
  "authjs.csrf-token",
  "__Host-authjs.csrf-token",
  "authjs.pkce.code_verifier",
  "__Secure-authjs.pkce.code_verifier",
  "authjs.state",
  "__Secure-authjs.state",
] as const;

export const _legacyAuthCookieNames = LEGACY_AUTH_COOKIE_NAMES;

/**
 * Structural type covering the subset of `NextRequest.cookies` /
 * `NextResponse.cookies` we use, so this module stays free of any
 * Node-only Next.js imports and still runs in the Edge proxy.
 */
interface LegacyCookieExpiryRequest {
  cookies: { getAll(): ReadonlyArray<{ name: string }> };
}
interface LegacyCookieExpiryResponse {
  cookies: {
    set(options: {
      name: string;
      value: string;
      maxAge: number;
      path: string;
      httpOnly: boolean;
      secure: boolean;
      sameSite: "lax" | "strict" | "none";
    }): unknown;
  };
}

/**
 * Expire-on-read any legacy NextAuth / Auth.js cookies still presented
 * by a browser that signed in before the `__Host-vf-*` migration.
 *
 * No-op when:
 *   - `VF_STRICT_MULTI_TENANT !== "true"` — only the strict profile
 *     rotated cookie names; OSS / dev keeps the defaults.
 *   - The request carries none of the listed legacy cookies — nothing
 *     to evict.
 *
 * For every legacy cookie present, sets a `Max-Age=0` `Set-Cookie` on
 * the response with the same `Path=/; HttpOnly; Secure; SameSite=Lax`
 * attributes the modern session cookie uses, so the browser drops it
 * immediately. Returns the number of cookies expired (useful for tests
 * and tracing).
 */
export function expireLegacyAuthCookies(
  request: LegacyCookieExpiryRequest,
  response: LegacyCookieExpiryResponse,
): number {
  if (process.env.VF_STRICT_MULTI_TENANT !== "true") return 0;

  const present = new Set(request.cookies.getAll().map((c) => c.name));
  let expired = 0;
  for (const name of LEGACY_AUTH_COOKIE_NAMES) {
    if (!present.has(name)) continue;
    response.cookies.set({
      name,
      value: "",
      maxAge: 0,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });
    expired++;
  }
  return expired;
}
