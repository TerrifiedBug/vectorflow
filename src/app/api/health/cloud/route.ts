/**
 * Legacy alias for `/api/health/deep`.
 *
 * Permanent 308 redirect, kept indefinitely so load-balancer probes
 * configured against the old path keep working without operator
 * action. 308 (not 301) preserves the HTTP method and forbids
 * intermediaries from rewriting the body.
 */

import { NextResponse } from "next/server";

export function GET(request: Request) {
  return redirect(request);
}

export function HEAD(request: Request) {
  return redirect(request);
}

function redirect(request: Request): Response {
  const url = new URL(request.url);
  url.pathname = "/api/health/deep";
  return NextResponse.redirect(url, 308);
}
