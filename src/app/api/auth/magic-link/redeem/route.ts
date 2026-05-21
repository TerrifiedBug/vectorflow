/**
 * Magic-link redeem endpoint.
 *
 * GET /api/auth/magic-link/redeem?token=...
 *
 * The user clicks this URL from their email. The handler resolves the
 * org from the request host, then renders a form-based bouncer page
 * that POSTs to NextAuth's `signIn("magic-link", { token, organizationId })`
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
 *
 * Security boundaries (codex P1 findings on PR #352, all addressed):
 *
 *   1. Org resolution uses `req.nextUrl.host` rather than the raw
 *      `Host:` header. Next.js builds `nextUrl` from a trusted source
 *      (the request's bound URL), so it cannot be spoofed by header
 *      injection.
 *
 *   2. The bouncer template emits the token / organizationId /
 *      callbackUrl as HTML-escaped attribute values inside a `<form>`,
 *      NOT as JSON inside an inline `<script>`. Attribute context is
 *      escape-correct under HTML rules; the previous inline-JSON
 *      approach required JS-string escaping (`</script>` + every Unicode
 *      line separator variant) which is brittle.
 *
 *   3. The bouncer's only inline script reads from form attributes
 *      via DOM lookups and submits the form. The script contains NO
 *      user-controllable strings, so it cannot be made to execute
 *      attacker JS.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveOrgIdFromHost } from "@/lib/host-to-org";
import { getRequestHostFromHeaders } from "@/lib/request-host";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return new NextResponse("missing token", { status: 400 });
  }

  // Derive the host from the request's `Host:` header (optionally
  // X-Forwarded-Host when the deployment trusts the upstream proxy
  // via VF_TRUST_FORWARDED_HOST / VF_TRUST_PROXY_HEADERS).
  // `req.nextUrl.host` returns the listen-socket authority on Next 16
  // Node-runtime builds, which collapses every tenant to
  // `DEFAULT_ORG_ID` and silently bypasses the redeem-host-binding
  // check (both sides agree on "default"). The header-derived value
  // matches what `/api/auth/magic-link/request` used when minting the
  // token, so `expectedOrganizationId` compares like-for-like.
  const host = getRequestHostFromHeaders(req.headers);
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
      // Belt-and-braces CSP: disallow inline-script other than the
      // form-submitter we emit. The hash matches the exact static
      // script body below. If you edit `BOUNCER_SCRIPT`, recompute
      // the hash and update both constants together.
      "Content-Security-Policy":
        `default-src 'none'; ` +
        `style-src 'unsafe-inline'; ` +
        `script-src '${BOUNCER_SCRIPT_HASH}'; ` +
        // connect-src 'self' is required so the bouncer script can call
        // fetch('/api/auth/csrf'). Without it, `default-src 'none'`
        // blocks the CSRF fetch and the form is never submitted.
        `connect-src 'self'; ` +
        `form-action 'self'; ` +
        `base-uri 'none'`,
    },
  });
}

/**
 * Escape a string for safe interpolation into an HTML attribute
 * value. Encodes the five characters that have syntactic meaning in
 * attribute context.
 */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Static bouncer script. Reads token / organizationId / callbackUrl
 * from the form's `data-*` attributes (already HTML-escape-encoded by
 * `escapeAttr` during render), fetches the NextAuth CSRF token, and
 * submits the form. NO user-controllable string is interpolated into
 * this script.
 */
const BOUNCER_SCRIPT = `(async function(){var f=document.getElementById("magic-link-form");var t=f.dataset.token;var o=f.dataset.org;var c=f.dataset.callback;try{var r=await fetch("/api/auth/csrf",{credentials:"same-origin"});var d=await r.json();function add(n,v){var i=document.createElement("input");i.type="hidden";i.name=n;i.value=v;f.appendChild(i);}add("csrfToken",d.csrfToken);add("token",t);add("organizationId",o);add("callbackUrl",c);f.submit();}catch(e){document.body.innerText="Sign-in failed. Please request a new magic link.";}})();`;

// CSP `script-src` hash for the script body above. Computed via
// `printf '%s' "$BOUNCER_SCRIPT" | openssl dgst -sha256 -binary | openssl base64`.
// The hash is committed alongside the script body. If the script body
// changes, recompute + update this constant in the same commit.
const BOUNCER_SCRIPT_HASH = "sha256-1+NtuPvyMNg/QtmfOb2radYiBdiS4Jbfh0vupbQ0k1A=";

function renderBouncer(args: {
  token: string;
  organizationId: string;
  callbackUrl: string;
}): string {
  // All three values flow into HTML attribute context. `escapeAttr`
  // encodes the syntactic characters; the attribute parser then
  // un-encodes them when the browser reads `data-token` via
  // `dataset.token` in the bouncer script. NO script-string escaping
  // is required — the values are never emitted into a JavaScript
  // string literal.
  const token = escapeAttr(args.token);
  const organizationId = escapeAttr(args.organizationId);
  const callbackUrl = escapeAttr(args.callbackUrl);

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
<form id="magic-link-form" method="POST" action="/api/auth/callback/magic-link" data-token="${token}" data-org="${organizationId}" data-callback="${callbackUrl}"></form>
<script>${BOUNCER_SCRIPT}</script>
</body>
</html>`;
}
