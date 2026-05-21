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
 *       via `VF_TRUST_FORWARDED_HOST=true`. This env var ONLY controls
 *       host-header trust; the older `VF_TRUST_PROXY_HEADERS` env var
 *       governs forwarded-client-IP trust (rate-limit keying, dev
 *       bypass) and intentionally does NOT enable host-header trust —
 *       conflating the two would silently widen the trust surface for
 *       any deployment that set `VF_TRUST_PROXY_HEADERS=true` to fix
 *       client-IP attribution without auditing host handling.
 *     - OSS deployments (no trusted proxy) keep the `host` header and
 *       ignore `x-forwarded-host`. A bad header from the client cannot
 *       redirect the request onto a different org.
 */

/**
 * Whether the deployment trusts the upstream proxy to set
 * `x-forwarded-host`. Returns `true` only when
 * `VF_TRUST_FORWARDED_HOST === "true"`.
 *
 * The legacy `VF_TRUST_PROXY_HEADERS` env is INTENTIONALLY not honoured
 * here — it controls forwarded-client-IP trust, not host trust.
 * `warnTrustForwardedHostIfOn` in `strict-multi-tenant-bootcheck.ts`
 * surfaces the gap if an operator sets only one and assumed they were
 * synonymous.
 */
export function trustsForwardedHost(env: Record<string, string | undefined> = process.env): boolean {
  return env.VF_TRUST_FORWARDED_HOST === "true";
}

/**
 * Resolve the request host from a `Headers` object (route-handler /
 * middleware context). Returns the bare `Host:` value when the proxy is
 * not trusted; otherwise returns the FIRST hop of `X-Forwarded-Host`
 * (RFC 7239 / common proxy chain convention) with a fall-back to
 * `Host:` so a request that bypasses the proxy still has a host.
 *
 * Multi-hop proxies append to `X-Forwarded-Host` left-to-right, so the
 * client-facing host is the leftmost entry (`tenant.example.com,
 * edge.internal` → `tenant.example.com`). Without splitting, the raw
 * header value gets used verbatim as `${proto}//${host}/…`, producing
 * malformed URLs and resolving to the wrong tenant in chained-proxy
 * setups.
 */
export function getRequestHostFromHeaders(
  headers: Headers,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (trustsForwardedHost(env)) {
    const xfh = headers.get("x-forwarded-host");
    if (xfh) {
      // Take only the first comma-separated hop. `split(",")[0]` is safe
      // because at least one element exists; `?.trim()` strips any
      // whitespace the proxy may have left between hops.
      const first = xfh.split(",", 1)[0]!.trim();
      if (first.length > 0) return first;
    }
    return headers.get("host");
  }
  return headers.get("host");
}
