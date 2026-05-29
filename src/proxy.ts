import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

import { authConfig } from "@/auth.config";
import { isDevAuthBypassRequestAllowed } from "@/lib/dev-auth-bypass";
import { expireLegacyAuthCookies } from "@/lib/strict-cookies";
import {
  contentSecurityPolicy,
  isStrictMultiTenantMode,
} from "@/lib/security-headers";

/**
 * Next.js proxy (auth gate + strict-multi-tenant CSP nonce).
 *
 * Why not `auth()` from NextAuth as a higher-order wrapper?
 *
 *   NextAuth v5's middleware helper (`auth(handler)`) used to wrap
 *   this file. On Next 16 Node-runtime builds the wrapper post-
 *   processes the inner response in a way that drops the
 *   `NextResponse.next({ request: { headers } })` directive — so the
 *   per-request `Content-Security-Policy` header we set on the
 *   request never reaches the RSC renderer, the framework's own
 *   inline boot scripts get rendered WITHOUT the `nonce` attribute,
 *   and `strict-dynamic` blocks them. Every customer-facing page
 *   renders blank. The fix is to call the nonce/CSP setup OURSELVES
 *   as the outermost response, do the session check directly via
 *   `getToken()`, and skip the `auth()` wrapper entirely. The
 *   `authorized` callback's logic is short and is replicated inline
 *   below.
 *
 * Route-specific CSP note: this only sets CSP when none is already
 * present on the response; route handlers that need a more-permissive
 * policy (e.g. Swagger UI) can set their own `Content-Security-Policy`
 * response header and this middleware will leave it in place.
 */

const NONCE_HEADER = "x-vf-csp-nonce";

function generateNonce(): string {
  // 16 bytes = 128 bits of entropy; base64 fits in 24 chars sans padding.
  // Use WebCrypto (available in the Edge runtime middleware context).
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Replicates the `authConfig.authorized` callback's path checks. Kept
 * in sync with `src/auth.config.ts`: every prefix that returns `true`
 * there MUST also return `true` here, otherwise an exempt route would
 * 302 to `/login` under strict mode where the middleware bypass for
 * unauthenticated requests no longer flows through `auth()`.
 */
function isExemptPath(pathname: string): boolean {
  if (pathname.startsWith("/login")) return true;
  if (pathname.startsWith("/setup")) return true;
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname.startsWith("/api/health")) return true;
  if (pathname.startsWith("/api/setup")) return true;
  if (pathname.startsWith("/api/v1")) return true;
  if (pathname.startsWith("/api/agent")) return true;
  if (pathname.startsWith("/api/scim")) return true;
  return false;
}

/**
 * Default session-cookie base names Auth.js (@auth/core) uses when no
 * explicit `cookies` override is configured. Over HTTPS it sets the
 * `__Secure-` prefixed variant; over HTTP it sets the bare one. The
 * encryption salt is derived from the same name.
 */
const AUTHJS_SESSION_COOKIE = "authjs.session-token";
const AUTHJS_SESSION_COOKIE_SECURE = `__Secure-${AUTHJS_SESSION_COOKIE}`;

/**
 * Resolve the session-cookie name `getToken()` must read for THIS request.
 *
 * Strict-multi-tenant mode configures Auth.js with an explicit
 * `__Host-vf-session` cookie (via `authConfig.cookies`); use that verbatim.
 *
 * Otherwise Auth.js named the cookie by the connection it served the
 * sign-in over — `__Secure-authjs.session-token` for HTTPS, bare
 * `authjs.session-token` for HTTP — and derived the JWE decryption salt
 * from that same name. `getToken()` does NOT infer the `__Secure-` prefix:
 * it defaults to `secureCookie: false` and therefore the BARE name, with
 * no view of the request protocol. On any HTTPS deployment that mismatch
 * means the gate never finds the cookie the browser is actually carrying,
 * `getToken()` returns null, and every authenticated request is bounced
 * back to /login — a redirect loop.
 *
 * We avoid protocol-sniffing (`nextUrl.protocol` is the internal http hop
 * behind a TLS-terminating proxy) by reading the name that is actually
 * present. Chunked cookies share the base name with a `.<n>` suffix, so a
 * prefix match catches them too. Prefer the secure name when both exist.
 * Returns `undefined` when no session cookie is present (unauthenticated).
 */
export function resolveSessionCookieName(
  cookieNames: readonly string[],
  override: string | undefined = authConfig.cookies?.sessionToken?.name,
): string | undefined {
  if (override) return override;
  const present = (base: string) =>
    cookieNames.some((n) => n === base || n.startsWith(`${base}.`));
  if (present(AUTHJS_SESSION_COOKIE_SECURE)) return AUTHJS_SESSION_COOKIE_SECURE;
  if (present(AUTHJS_SESSION_COOKIE)) return AUTHJS_SESSION_COOKIE;
  return undefined;
}

async function hasValidSession(req: NextRequest): Promise<boolean> {
  // Empty AUTH_SECRET would cause getToken to throw at runtime; we
  // treat the absence as "not authenticated" rather than crashing,
  // and let the request flow to the login redirect.
  const secret =
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    "";
  if (!secret) return false;

  const cookieName = resolveSessionCookieName(
    req.cookies.getAll().map((c) => c.name),
  );
  try {
    const token = await getToken({
      // next-auth/jwt's getToken expects a NextApiRequest-like shape;
      // NextRequest exposes `cookies` differently, so the helper also
      // accepts NextRequest via the `req` field by inspecting headers.
      // Both shapes are valid in v5; we pass the NextRequest as-is.
      req,
      secret,
      // Pass both `cookieName` and `secureCookie` so getToken reads the
      // exact cookie Auth.js set AND derives the matching decryption salt.
      // `secureCookie` is implied by the `__Secure-` prefix; deriving it
      // here keeps the two consistent if @auth/core ever uses the flag
      // during reads.
      ...(cookieName
        ? {
            cookieName,
            secureCookie: cookieName.startsWith("__Secure-") || cookieName.startsWith("__Host-"),
          }
        : {}),
    });
    return !!token;
  } catch {
    // A malformed cookie or rotated secret throws — treat as
    // unauthenticated so the user is sent through the normal login
    // flow rather than seeing a 500.
    return false;
  }
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  // (1) Auth gate — replicates authConfig.authorized.
  // Dev-auth bypass takes precedence over the session check so a
  // bypass-enabled local environment does not require a real cookie.
  const exempt = isExemptPath(req.nextUrl.pathname);
  const bypass = isDevAuthBypassRequestAllowed(req);
  if (!exempt && !bypass && !(await hasValidSession(req))) {
    const loginUrl = new URL("/login", req.url);
    // Preserve the originally requested path so the post-login
    // bouncer can return the user where they were aiming.
    const target = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    if (target !== "/") loginUrl.searchParams.set("callbackUrl", target);
    const redirect = NextResponse.redirect(loginUrl);
    expireLegacyAuthCookies(req, redirect);
    return redirect;
  }

  // (2) OSS / non-strict profile — no nonce work, leave the static
  // CSP from next.config.ts in place. `expireLegacyAuthCookies` is a
  // no-op when VF_STRICT_MULTI_TENANT is off, so the call is free.
  if (!isStrictMultiTenantMode()) {
    const response = NextResponse.next();
    expireLegacyAuthCookies(req, response);
    return response;
  }

  // (3) Strict-multi-tenant profile — generate a per-request nonce,
  // attach it to both the request (so RSC `headers()` reads pick it
  // up and Next's renderer applies it to framework inline scripts)
  // and the response (so the browser enforces it under
  // `script-src 'self' 'nonce-…' 'strict-dynamic'`).
  const nonce = generateNonce();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy(nonce));

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  if (!response.headers.get("Content-Security-Policy")) {
    response.headers.set(
      "Content-Security-Policy",
      contentSecurityPolicy(nonce),
    );
  }
  // Mirror the nonce on the response so downstream proxies / tracing
  // can correlate without parsing the CSP value.
  response.headers.set(NONCE_HEADER, nonce);

  // Evict any pre-migration NextAuth / Auth.js cookies the browser
  // still carries. The session-token rename to `__Host-vf-session`
  // is otherwise a soft cutover that leaves orphan cookies in place
  // indefinitely.
  expireLegacyAuthCookies(req, response);

  return response;
}

export const config = {
  matcher: [
    "/((?!api/auth|api/trpc|api/v1|api/agent|api/scim|api/backups|_next/static|_next/image|_next/webpack-hmr|__nextjs_font|favicon.ico|login|setup).*)",
  ],
};
