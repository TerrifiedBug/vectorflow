/**
 * Cloud-profile CSP nonce middleware (plan §16b OSS item 7).
 *
 * Active when `VF_CLOUD_BUILD=true`. Generates a fresh 16-byte
 * base64-encoded nonce per request, propagates it through the
 * `x-vf-csp-nonce` request header so Server Components can read it via
 * `headers()`, and rewrites the response `Content-Security-Policy`
 * header to embed the nonce + drop `'unsafe-eval'` / `'unsafe-inline'`
 * from `script-src`.
 *
 * No-op under the OSS profile: the middleware short-circuits without
 * touching headers, so self-hosted deployments are unaffected.
 *
 * Server-component pattern for consuming the nonce:
 *
 *   import { headers } from "next/headers";
 *   const nonce = (await headers()).get("x-vf-csp-nonce");
 *   <script nonce={nonce ?? undefined}>{inlineScript}</script>
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  contentSecurityPolicy,
  isCloudBuildProfile,
} from "@/lib/security-headers";

const NONCE_HEADER = "x-vf-csp-nonce";

function generateNonce(): string {
  // 16 bytes = 128 bits of entropy; base64 fits in 24 chars sans padding.
  // Use WebCrypto (available in the Edge runtime middleware context).
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Manual base64 to avoid Node Buffer in the Edge runtime.
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function middleware(req: NextRequest) {
  if (!isCloudBuildProfile()) {
    // OSS profile — leave the static CSP from next.config.ts in place.
    return NextResponse.next();
  }

  const nonce = generateNonce();

  // Forward the nonce on the request so Server Components can read it.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(NONCE_HEADER, nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Overwrite the static CSP with the nonce-bearing variant. Other
  // security headers (COOP, COEP, X-Frame-Options, etc.) stay as set
  // by next.config.ts.
  response.headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  // Mirror the nonce on the response too so downstream proxies /
  // tracing can correlate. Not security-sensitive (the nonce is in the
  // CSP header in plain text already).
  response.headers.set(NONCE_HEADER, nonce);

  return response;
}

/**
 * Apply the middleware to every request EXCEPT static assets — Next
 * already CDN-caches `/_next/static/*` and `/_next/image`, so injecting
 * a per-request nonce there would defeat caching for no benefit (the
 * cached responses are not HTML and don't carry inline scripts).
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except those starting with:
     * - api (handled by route handlers, not Server Components — but
     *   we still want CSP on JSON 4xx error pages, so leave api on
     *   the match list for now).
     * - _next/static (static files; immutable, no inline scripts)
     * - _next/image (next/image optimised assets)
     * - favicon.ico (static)
     * - public assets matched by file extension.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|otf|js\\.map|css\\.map)$).*)",
  ],
};
