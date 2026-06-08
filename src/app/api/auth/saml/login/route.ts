import { NextResponse } from "next/server";

import { resolveOrgIdFromHost } from "@/lib/host-to-org";
import { getRequestHostFromHeaders } from "@/lib/request-host";
import { warnLog } from "@/lib/logger";
import { getSamlSettings } from "@/server/services/auth/saml-config";
import {
  resolveSpEndpoints,
  beginSamlLogin,
  sanitizeReturnTo,
  samlStateCookieOptions,
  SAML_STATE_COOKIE,
  SAML_LOGIN_ERROR_REDIRECT,
} from "@/server/services/auth/saml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SP-initiated SAML login. Resolves the org from the request host, builds the
 * AuthnRequest redirect to the org's IdP SSO URL with a RelayState nonce, and
 * sets the single-use state cookie that pins the request id + nonce to this
 * browser for the ACS callback. Redirects to the login page on any failure.
 */
export async function GET(request: Request): Promise<Response> {
  const endpoints = resolveSpEndpoints(request);
  const orgId = await resolveOrgIdFromHost(getRequestHostFromHeaders(request.headers));
  const settings = await getSamlSettings(orgId);
  if (!settings) {
    return NextResponse.redirect(new URL(SAML_LOGIN_ERROR_REDIRECT, endpoints.origin));
  }

  const url = new URL(request.url);
  const returnTo = sanitizeReturnTo(
    url.searchParams.get("callbackUrl") ?? url.searchParams.get("returnTo"),
  );

  try {
    const { redirectUrl, stateCookieValue } = await beginSamlLogin(settings, endpoints, returnTo);
    const res = NextResponse.redirect(redirectUrl);
    res.cookies.set(SAML_STATE_COOKIE, stateCookieValue, samlStateCookieOptions(endpoints.secure));
    return res;
  } catch (err) {
    warnLog("saml", "Failed to build SAML AuthnRequest", err);
    return NextResponse.redirect(new URL(SAML_LOGIN_ERROR_REDIRECT, endpoints.origin));
  }
}
