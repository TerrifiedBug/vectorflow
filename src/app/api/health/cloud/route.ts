/**
 * Compatibility shim — `/api/health/cloud` was renamed to `/api/health/deep`
 * to drop a vendor-specific label from the OSS surface. Load balancers and
 * dashboards probing the old path get a permanent 308 redirect so they
 * keep working without any operator action.
 *
 * Why 308 (not 301): 308 preserves the request method and forbids
 * intermediaries from rewriting the body. Most LB health-checkers send
 * `GET` so the method preservation is moot, but the explicit "do not
 * change the request" semantics is the safer contract.
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
