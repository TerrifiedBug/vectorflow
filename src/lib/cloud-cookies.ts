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
