import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { resolveOrgIdFromHost } from "@/lib/host-to-org";
import { getRequestHostFromHeaders } from "@/lib/request-host";
import { warnLog } from "@/lib/logger";
import { getSamlSettings } from "@/server/services/auth/saml-config";
import {
  resolveSpEndpoints,
  consumeSamlState,
  validateSamlResponse,
  provisionSamlUser,
  buildSamlSessionCookie,
  extractSamlEmail,
  sanitizeReturnTo,
  samlStateCookieOptions,
  SAML_STATE_COOKIE,
  SAML_LOGIN_ERROR_REDIRECT,
} from "@/server/services/auth/saml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SAML Assertion Consumer Service (ACS). Validates the IdP's signed POST
 * (signature against the org IdP cert, audience == our SP EntityID,
 * InResponseTo bound to the issued request via the single-use state cookie,
 * RelayState CSRF nonce, and assertion expiry — all enforced by
 * `validateSamlResponse`), provisions/links the user, and mints the same
 * per-org session an OIDC sign-in would. Any failure redirects to /login with
 * a generic error; no session is set. Uses 303 so the browser GETs the
 * post-login target after this POST.
 */
export async function POST(request: Request): Promise<Response> {
  const endpoints = resolveSpEndpoints(request);
  const failUrl = new URL(SAML_LOGIN_ERROR_REDIRECT, endpoints.origin);

  const orgId = await resolveOrgIdFromHost(getRequestHostFromHeaders(request.headers));
  const settings = await getSamlSettings(orgId);
  if (!settings) return NextResponse.redirect(failUrl, 303);

  let samlResponse: string | null = null;
  let relayState: string | null = null;
  try {
    const form = await request.formData();
    const response = form.get("SAMLResponse");
    const relay = form.get("RelayState");
    samlResponse = typeof response === "string" ? response : null;
    relayState = typeof relay === "string" ? relay : null;
  } catch {
    return NextResponse.redirect(failUrl, 303);
  }
  if (!samlResponse) return NextResponse.redirect(failUrl, 303);

  // CSRF + replay binding: the state cookie must decode, belong to this org,
  // and carry the same RelayState nonce the IdP echoed back.
  const cookieStore = await cookies();
  const state = await consumeSamlState(
    cookieStore.get(SAML_STATE_COOKIE)?.value,
    relayState,
    orgId,
  );
  if (!state) return NextResponse.redirect(failUrl, 303);

  let profile;
  try {
    // Throws on unsigned / bad-signature / wrong-audience / expired /
    // InResponseTo-mismatch — never extracts attributes without a verified,
    // solicited, in-window signature.
    profile = await validateSamlResponse(settings, endpoints, samlResponse, state.rid);
  } catch (err) {
    warnLog("saml", "SAML response validation failed", err);
    return NextResponse.redirect(failUrl, 303);
  }

  const email = extractSamlEmail(profile);
  if (!email) return NextResponse.redirect(failUrl, 303);

  const ipAddress =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;
  const result = await provisionSamlUser(orgId, settings, profile, ipAddress);

  // Always clear the single-use state cookie, success or fail.
  const clearState = { ...samlStateCookieOptions(endpoints.secure), maxAge: 0 };

  if ("errorRedirect" in result) {
    const res = NextResponse.redirect(new URL(result.errorRedirect, endpoints.origin), 303);
    res.cookies.set(SAML_STATE_COOKIE, "", clearState);
    return res;
  }

  const name = typeof profile.displayName === "string" ? profile.displayName : null;
  const cookie = await buildSamlSessionCookie({
    orgId,
    userId: result.userId,
    name,
    email,
    secure: endpoints.secure,
  });
  const res = NextResponse.redirect(new URL(sanitizeReturnTo(state.returnTo), endpoints.origin), 303);
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  res.cookies.set(SAML_STATE_COOKIE, "", clearState);
  return res;
}
