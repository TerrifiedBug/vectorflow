import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { NextResponse, type NextRequest } from "next/server";
import {
  contentSecurityPolicy,
  isStrictMultiTenantMode,
} from "@/lib/security-headers";

/**
 * Next.js proxy (auth gate + strict-multi-tenant CSP nonce).
 *
 * Uses the lightweight auth.config.ts which does NOT import Prisma or any
 * Node.js-only modules, so it runs safely in the Edge runtime.
 *
 * When VF_STRICT_MULTI_TENANT=true, also injects a per-request CSP nonce so that
 * Server Components can use it via `headers().get("x-vf-csp-nonce")`.
 * OSS builds short-circuit before touching any headers.
 *
 * Route-specific CSP note: this only sets CSP when none is already present
 * on the response; route handlers that need a more-permissive policy (e.g.
 * Swagger UI) can set their own `Content-Security-Policy` response header
 * and this middleware will leave it in place.
 */
const { auth } = NextAuth(authConfig);

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

export const proxy = auth(function middleware(req: NextRequest) {
  if (!isStrictMultiTenantMode()) {
    // OSS profile — leave the static CSP from next.config.ts in place.
    return NextResponse.next();
  }

  const nonce = generateNonce();

  // Forward the nonce on the request so Server Components can read it, and
  // set the nonce-bearing CSP on the request so Next.js applies the nonce
  // attribute to its own rendered scripts during SSR.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy(nonce));

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Set the nonce-bearing CSP only when no route-specific policy exists.
  // This preserves tighter policies set by individual route handlers.
  if (!response.headers.get("Content-Security-Policy")) {
    response.headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  }
  // Mirror the nonce on the response so downstream proxies / tracing can
  // correlate without parsing the CSP value.
  response.headers.set(NONCE_HEADER, nonce);

  return response;
});

export const config = {
  matcher: [
    "/((?!api/auth|api/trpc|api/v1|api/agent|api/scim|api/backups|_next/static|_next/image|_next/webpack-hmr|__nextjs_font|favicon.ico|login|setup).*)",
  ],
};
