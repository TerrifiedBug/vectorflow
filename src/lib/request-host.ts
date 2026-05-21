/**
 * Resolve the request host used for per-org auth routing.
 *
 * Why not `req.nextUrl.host`?
 *
 *   In Next 16 Node-runtime production builds `req.nextUrl.host` returns
 *   the *listening* socket's authority (`0.0.0.0:3000` inside a container)
 *   rather than the value carried by the request's `Host:` header. Routes
 *   that derive the tenant slug from `nextUrl.host` therefore see the
 *   listen address and fall through to `DEFAULT_ORG_ID = "default"` on
 *   every request — collapsing every tenant subdomain to the default org.
 *
 * Why not `host` unconditionally?
 *
 *   `x-forwarded-host` is client-controlled unless the upstream proxy
 *   strips/rewrites it. Reading it unconditionally lets a direct request
 *   (or a mis-configured proxy chain) spoof another tenant's slug and
 *   force this request onto a different tenant's OIDC / group-mapping
 *   config. The compromise is opt-in:
 *
 *     - Multi-tenant deployments run behind a known reverse proxy that
 *       ALWAYS sets `x-forwarded-host` itself, and the operator opts in
 *       via either `VF_TRUST_FORWARDED_HOST=true` or the legacy
 *       `VF_TRUST_PROXY_HEADERS=true` env (the two names diverged
 *       historically; both are accepted so existing self-hosted compose
 *       files keep working).
 *     - OSS deployments (no trusted proxy) keep the `host` header and
 *       ignore `x-forwarded-host`. A bad header from the client cannot
 *       redirect the request onto a different org.
 */

/**
 * Whether the deployment trusts the upstream proxy to set
 * `x-forwarded-host`. Accepts either env name; if neither is `"true"`,
 * proxy headers are ignored.
 */
export function trustsForwardedHost(env: Record<string, string | undefined> = process.env): boolean {
  return (
    env.VF_TRUST_FORWARDED_HOST === "true" ||
    env.VF_TRUST_PROXY_HEADERS === "true"
  );
}

/**
 * Resolve the request host from a `Headers` object (route-handler /
 * middleware context). Returns the bare `Host:` value when the proxy is
 * not trusted; otherwise returns `X-Forwarded-Host` with a fall-back to
 * `Host:` so a request that bypasses the proxy still has a host.
 */
export function getRequestHostFromHeaders(
  headers: Headers,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (trustsForwardedHost(env)) {
    return headers.get("x-forwarded-host") ?? headers.get("host");
  }
  return headers.get("host");
}
