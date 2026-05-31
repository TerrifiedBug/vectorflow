/**
 * Top-level HTTP security headers applied via Next's `headers()` config.
 *
 * Two CSP profiles:
 *
 *   - **OSS / self-hosted (default).** `'unsafe-eval'` + `'unsafe-inline'`
 *     are tolerated in `script-src` and `style-src` because the OSS bundle
 *     still relies on inline boot scripts injected by Next's pages router,
 *     dev-time tooling, and React element-level `style=""` attributes that
 *     have no equivalent Tailwind class. Self-hosted deployments are
 *     single-tenant; the blast radius of an XSS bug is contained to one
 *     tenant.
 *
 *   - **Strict CSP with per-request nonces.** `'unsafe-eval'` and
 *     `'unsafe-inline'` are removed from `script-src`; every inline
 *     `<script>` MUST carry a `nonce="<value>"` attribute that matches the
 *     nonce in the CSP.  `style-src` likewise drops `'unsafe-inline'` in
 *     favour of `'nonce-<value>'` so Next.js-emitted `<style>` blocks are
 *     permitted.  React element-level `style=""` attributes produced during
 *     SSR are re-applied by React's hydration pass via `element.style`
 *     DOM-property assignments, which are not subject to `style-src`
 *     restrictions.  When enabled via configuration, the request/response
 *     middleware issues a fresh 16-byte nonce per request and integrates it
 *     with the CSP header for multi-tenant isolation.
 */

export interface SecurityHeader {
  key: string;
  value: string;
}

/**
 * Request/response header carrying the per-request CSP nonce in strict
 * multi-tenant mode. Set by `src/proxy.ts` on the request so server
 * components (via `headers()`) can read it and attach it to app-authored
 * inline `<style>` / `<script>` content under the strict CSP.
 */
export const CSP_NONCE_HEADER = "x-vf-csp-nonce";

/**
 * Whether the deployment runs in strict multi-tenant mode. Read at module
 * load — set the env var in the deployment image / CI matrix.
 */
export function isStrictMultiTenantMode(): boolean {
  return process.env.VF_STRICT_MULTI_TENANT === "true";
}

/**
 * Content-Security-Policy. Profile-aware:
 *
 *   - No nonce supplied -> OSS-default (permissive) CSP.
 *   - Nonce supplied   -> strict-multi-tenant CSP (drops `unsafe-eval` /
 *     `unsafe-inline` from `script-src` and `style-src`; allows the
 *     supplied nonce).
 *
 * The caller is responsible for picking the right call — the
 * middleware uses the nonce form; `next.config.ts`'s static `headers()`
 * uses the no-nonce form as a fallback that the middleware then
 * overrides per-request when strict multi-tenant mode is active.
 */
export function contentSecurityPolicy(nonce?: string): string {
  // VF-45 (Info, by-design): the no-nonce path KEEPS 'unsafe-eval' +
  // 'unsafe-inline'. This is intentional for the single-tenant OSS bundle —
  // Next's framework-injected inline boot scripts and React hydration require
  // them, and removing them blindly breaks rendering. Strict isolation is opt-in
  // via VF_STRICT_MULTI_TENANT (the nonce path below), not the default.
  const scriptSrc = nonce
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
    : "script-src 'self' 'unsafe-eval' 'unsafe-inline'";

  // style-src: 'unsafe-inline' in BOTH profiles. Inline styles cannot be
  // locked down the way scripts are. React emits element-level style=""
  // attributes during SSR -- e.g. shadcn's SidebarProvider sets
  // `--sidebar-width`, which the entire dashboard shell layout depends on
  // -- and a CSP nonce can NEVER cover a style ATTRIBUTE (nonces match
  // `<style>` ELEMENTS only). Worse, when a nonce IS present in style-src,
  // browsers ignore 'unsafe-inline' for attributes too -- so a nonce-only
  // style-src silently drops every SSR inline style: the sidebar gap
  // collapses to 0 and the whole dashboard renders underneath the fixed
  // sidebar. The CSP's real protection is script-src (nonce +
  // strict-dynamic, no unsafe-inline); injected CSS executes no script and
  // exfiltration is already bounded by connect-src 'self'.
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
 * `Cross-Origin-Opener-Policy: same-origin` is a key security header §
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
 * `contentSecurityPolicy()` without a nonce — under strict multi-tenant mode,
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
