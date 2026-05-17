/**
 * Magic-link redeem endpoint (plan §8 / §16b OSS-9).
 *
 * GET /api/auth/magic-link/redeem?token=...
 *
 * The user clicks this URL from their email. The handler resolves the
 * org from the request host, then renders a tiny self-submitting HTML
 * page that POSTs to NextAuth's `signIn("magic-link", { token, organizationId })`
 * flow. This indirection is needed because NextAuth Credentials
 * authorization runs on POST, and the email client can only navigate
 * the user via GET.
 *
 * Token validation happens in `consumeMagicLink` inside the
 * Credentials provider; the redeem page itself does not verify — it
 * just hands the token to NextAuth.
 *
 * On bad tokens (expired / replayed / wrong org), NextAuth renders
 * its standard credentials-error page. We do not echo the token in
 * any error path; the bouncer page contains only the token to hand
 * off and the CSRF token NextAuth needs.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveOrgIdFromHost } from "@/lib/host-to-org";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return new NextResponse("missing token", { status: 400 });
  }

  const host = req.headers.get("host") ?? "";
  const organizationId = await resolveOrgIdFromHost(host);
  const callbackUrl = req.nextUrl.searchParams.get("callbackUrl") ?? "/";

  // Build the NextAuth credentials callback URL. NextAuth handles CSRF
  // by reading the csrfToken from its own /api/auth/csrf endpoint and
  // verifying it on the POST; we render a tiny page that does that
  // round-trip in the user's browser.
  const html = renderBouncer({ token, organizationId, callbackUrl });

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

function renderBouncer(args: {
  token: string;
  organizationId: string;
  callbackUrl: string;
}): string {
  // Escaping note: every field is JSON-stringified before being
  // emitted into the inline script so HTML / script injection in
  // organizationId or callbackUrl cannot break out of the string
  // literal. The token is opaque base64url and is also stringified.
  const payload = JSON.stringify({
    token: args.token,
    organizationId: args.organizationId,
    callbackUrl: args.callbackUrl,
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Signing you in…</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
<noscript>
  <p>JavaScript is required to complete sign-in.</p>
</noscript>
<p>Signing you in…</p>
<script>
(async function () {
  const payload = ${payload};
  try {
    const csrfRes = await fetch("/api/auth/csrf", { credentials: "same-origin" });
    const { csrfToken } = await csrfRes.json();
    const body = new URLSearchParams({
      csrfToken,
      token: payload.token,
      organizationId: payload.organizationId,
      callbackUrl: payload.callbackUrl,
    });
    const r = await fetch("/api/auth/callback/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      credentials: "same-origin",
      redirect: "follow",
    });
    if (r.redirected) {
      window.location.href = r.url;
    } else {
      window.location.href = payload.callbackUrl;
    }
  } catch (err) {
    document.body.innerText = "Sign-in failed. Please request a new magic link.";
  }
})();
</script>
</body>
</html>`;
}
