/**
 * Magic-link request endpoint.
 *
 * POST { email } from the sign-in page. The server resolves the org
 * from the request host, mints a one-time token, and sends an email
 * containing the redeem URL. The plaintext token is returned ONLY in
 * non-production builds for ergonomic dev-loop testing — production
 * builds NEVER echo the token back.
 *
 * Anti-enumeration: we always return 200 regardless of whether the
 * email is known. An attacker probing for valid emails sees the same
 * latency + response on both paths. The Audit log on the server side
 * still records the (successful or no-op) attempt.
 *
 * SSO precedence: if the org has OIDC configured, `mintMagicLink`
 * throws `MagicLinkSsoOnlyError`. We translate that into a 200 with
 * an informational body ("This organization uses SSO. Click 'Sign in
 * with SSO' to continue.") rather than an error — the client UX is
 * still that the request "succeeded" but the user is redirected.
 *
 * Rate limit: per-IP at the gateway layer; per-email is enforced by
 * the magic-link service's mint rate limit (TBD; the current
 * implementation does not throttle internally, so the gateway must).
 */

import { NextRequest, NextResponse } from "next/server";

import { mintMagicLink, MagicLinkSsoOnlyError } from "@/server/services/auth/magic-link";
import { resolveOrgIdFromHost } from "@/lib/host-to-org";
import { warnLog, infoLog } from "@/lib/logger";
import { checkIpRateLimit } from "@/app/api/_lib/ip-rate-limit";
import { getRequestHostFromHeaders } from "@/lib/request-host";
import { sendMagicLinkEmail } from "@/server/services/auth/magic-link-mailer";

interface RequestBody {
  email?: string;
}

const IS_DEV = process.env.NODE_ENV !== "production";

export async function POST(req: NextRequest) {
  // Rate-limit before touching the DB: each request can mint a token
  // and trigger an outbound email, so unbounded calls are a practical
  // DoS / mail-spam vector.
  const limited = await checkIpRateLimit(req, "auth:magic-link-request", 5);
  if (limited) return limited;

  let body: RequestBody = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if (typeof body.email !== "string" || !isPlausibleEmail(body.email)) {
    return NextResponse.json({ ok: true }); // anti-enumeration; same response shape
  }

  // Derive the host from the request's `Host:` header (optionally
  // X-Forwarded-Host when the deployment trusts the upstream proxy
  // via VF_TRUST_FORWARDED_HOST / VF_TRUST_PROXY_HEADERS).
  // `req.nextUrl.host` is unsuitable here: on Next 16 Node-runtime
  // builds it returns the listening socket's authority
  // (`0.0.0.0:3000` inside a container) instead of the proxied host,
  // collapsing every tenant subdomain to `DEFAULT_ORG_ID`.
  const host = getRequestHostFromHeaders(req.headers);
  const organizationId = await resolveOrgIdFromHost(host);

  try {
    const { token, expiresAt } = await mintMagicLink({
      organizationId,
      email: body.email,
      requestIp: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    });

    // Build the redeem URL from the resolved host so the link the
    // user clicks lands on the tenant subdomain that minted it. The
    // scheme comes from `req.url` (built by Next.js from the trusted
    // request URL) so we honour http vs https without trusting the
    // header alone.
    const requestUrl = new URL(req.url);
    const scheme = requestUrl.protocol; // "https:" / "http:"
    const baseUrl = host ? `${scheme}//${host}` : requestUrl.origin;
    const redeemUrl = `${baseUrl}/api/auth/magic-link/redeem?token=${encodeURIComponent(token)}`;

    await sendMagicLinkEmail({
      email: body.email,
      redeemUrl,
      expiresAt,
    });

    infoLog(
      "magic-link-request",
      `magic link sent to ${maskEmail(body.email)} (org=${organizationId})`,
    );

    // Dev convenience only — never echo the token in production.
    if (IS_DEV) {
      return NextResponse.json({
        ok: true,
        dev_only_redeem_url: redeemUrl,
        dev_only_expires_at: expiresAt.toISOString(),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof MagicLinkSsoOnlyError) {
      return NextResponse.json({
        ok: true,
        sso_only: true,
      });
    }
    warnLog("magic-link-request", "mintMagicLink failed", err);
    // Still return 200 to preserve anti-enumeration — the user retries
    // and we surface the real failure to operators via logs.
    return NextResponse.json({ ok: true });
  }
}


function isPlausibleEmail(s: string): boolean {
  // Cheap surface check — RFC 5322 is overkill for the rate-limit /
  // anti-enumeration tier. Real validation happens at the user-create
  // path inside the magic-link provider.
  return s.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

function maskEmail(s: string): string {
  const at = s.indexOf("@");
  if (at <= 0) return "***";
  const local = s.slice(0, at);
  const domain = s.slice(at);
  return `${local[0]}***${local[local.length - 1] ?? ""}${domain}`;
}
