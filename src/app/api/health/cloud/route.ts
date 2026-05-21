/**
 * Legacy alias for `/api/health/deep`.
 *
 * Permanent 308 redirect, kept indefinitely so load-balancer probes
 * configured against the old path keep working without operator
 * action. 308 (not 301) preserves the HTTP method and forbids
 * intermediaries from rewriting the body.
 *
 * The redirect emits a `Location: /api/health/deep[?query]` value
 * (relative URL). Building an absolute URL from `request.url` would
 * echo the listening socket's host:port (e.g. `0.0.0.0:3000` inside
 * the container) instead of the proxied host, so any external probe
 * that follows the redirect would land on an unroutable address.
 * Relative `Location` values are valid under RFC 7231 §7.1.2 and
 * resolve against the request's effective URI, so the client follows
 * back to the same host it called. Query strings are preserved
 * verbatim — probes may pass `?verbose=1` etc.
 */

import { NextResponse } from "next/server";

const DEEP_HEALTH_PATH = "/api/health/deep";

export function GET(request: Request): Response {
  return redirect(request);
}

export function HEAD(request: Request): Response {
  return redirect(request);
}

function redirect(request: Request): Response {
  const url = new URL(request.url);
  const location = url.search
    ? `${DEEP_HEALTH_PATH}${url.search}`
    : DEEP_HEALTH_PATH;
  return new NextResponse(null, {
    status: 308,
    headers: { Location: location },
  });
}
