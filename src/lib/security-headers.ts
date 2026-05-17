/**
 * Top-level HTTP security headers applied via Next's `headers()` config.
 *
 * Two CSP profiles:
 *
 *   - **OSS / self-hosted (default).** `'unsafe-eval'` + `'unsafe-inline'`
 *     are tolerated in `script-src` because the OSS bundle still relies
 *     on inline boot scripts injected by Next's pages router and
 *     dev-time tooling. Self-hosted deployments are single-tenant; the
 *     blast radius of an XSS bug is contained to one tenant.
 *
 *   - **Cloud (`VF_CLOUD_BUILD=true`).** Strict CSP with per-request
 *     nonces. `'unsafe-eval'` and `'unsafe-inline'` are removed; every
 *     inline `<script>` MUST carry a `nonce="<value>"` attribute that
 *     matches the nonce in the CSP. The middleware in
 *     `src/middleware.ts` issues a fresh 16-byte nonce per request,
 *     propagates it through the `x-vf-csp-nonce` request header (so
 *     Server Components can read it via `headers()`), and rewrites the
 *     `Content-Security-Policy` response header.
 *
 *     This is the plan §16b OSS item 7 deliverable; the Cloud build
 *     enables it when shipping a multi-tenant stamp where one tenant's
 *     XSS could read another tenant's session token.
 */

export interface SecurityHeader {
  key: string;
  value: string;
}

/**
 * Whether the current build is the Cloud profile. Read at module
 * load — set the env var in the Cloud Docker image / CI matrix.
 */
export function isCloudBuildProfile(): boolean {
  return process.env.VF_CLOUD_BUILD === "true";
}

/**
 * Content-Security-Policy. Profile-aware:
 *
 *   - No nonce supplied -> OSS-default (permissive) CSP.
 *   - Nonce supplied   -> Cloud-strict CSP (drops `unsafe-eval` /
 *     `unsafe-inline` from `script-src`; allows the supplied nonce).
 *
 * The caller is responsible for picking the right call — the
 * middleware uses the nonce form; `next.config.ts`'s static `headers()`
 * uses the no-nonce form as a fallback that the middleware then
 * overrides per-request when the Cloud profile is active.
 */
export function contentSecurityPolicy(nonce?: string): string {
  const scriptSrc = nonce
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
    : "script-src 'self' 'unsafe-eval' 'unsafe-inline'";

  // style-src: inline styles are widely used (Tailwind JIT classes,
  // shadcn component props). The Cloud profile keeps 'unsafe-inline'
  // on style-src for now — style-based XSS is materially harder to
  // weaponise than script-based XSS, and removing it would require a
  // full Tailwind v4 cutover with hashed style chunks. Tracked as a
  // follow-up; do NOT widen script-src to compensate.
  const styleSrc = "style-src 'self' 'unsafe-inline'";

  return [
    "default-src 'self'",
    scriptSrc,
    styleSrc,
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
 *
 * The `Content-Security-Policy` header value comes from
 * `contentSecurityPolicy()` without a nonce — under the Cloud profile,
 * `src/middleware.ts` overwrites this per-request with a nonce-bearing
 * value.
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
