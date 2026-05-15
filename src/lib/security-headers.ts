/**
 * Top-level HTTP security headers applied via Next's `headers()` config.
 *
 * Extracted from `next.config.ts` so the value list is unit-testable and
 * Cloud builds can tighten it (nonce-based CSP, stricter COOP/COEP) via
 * dedicated overrides without diverging the OSS default.
 */

export interface SecurityHeader {
  key: string;
  value: string;
}

/**
 * Content-Security-Policy. Returns the directives joined into the wire
 * format. Pre-Cloud the OSS default still allows `'unsafe-eval'` and
 * `'unsafe-inline'` in `script-src`; the Cloud build will need to swap
 * these for nonces once we have a Server Components rollout (separate PR).
 */
export function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' *.sentry.io",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
}

/**
 * Top-level security headers applied to every response.
 *
 * `Cross-Origin-Opener-Policy: same-origin` is the plan addendum §8
 * requirement: under multi-tenant subdomain isolation, a tenant page
 * cannot retain a JS reference to another tenant page opened from it.
 * (Without COOP, `window.opener` survives the navigation; with COOP it
 * is severed by the browser.)
 *
 * `Cross-Origin-Resource-Policy: same-origin` blocks no-cors fetches of
 * this response from other origins — protects against speculative
 * cross-tenant resource reads.
 */
export function securityHeaders(): SecurityHeader[] {
  return [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
    { key: "X-DNS-Prefetch-Control", value: "on" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  ];
}
