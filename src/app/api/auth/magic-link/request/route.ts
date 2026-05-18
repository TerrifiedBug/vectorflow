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

  // Codex P1 (PR #352): use `req.nextUrl.host` (Next.js's trusted
  // request URL) rather than the raw `Host:` header. Raw Host is
  // attacker-controlled; a spoofed value could mint a token bound to
  // the attacker's org with a victim's email.
  const host = req.nextUrl.host;
  const organizationId = await resolveOrgIdFromHost(host);

  try {
    const { token, expiresAt } = await mintMagicLink({
      organizationId,
      email: body.email,
      requestIp: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    });

    // Use server-derived origin (req.nextUrl) rather than the client-controlled
    // `Origin` header, which could be spoofed to embed an attacker's URL.
    const baseUrl = req.nextUrl.origin;
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

/**
 * Send a magic-link email. OSS default: log the redeem URL to the
 * server console (so a self-hosted operator can wire any mail relay
 * they want).
 */
async function sendMagicLinkEmail(args: {
  email: string;
  redeemUrl: string;
  expiresAt: Date;
}): Promise<void> {
  // OSS default: no real send. Operators wiring magic-link locally are
  // expected to provide their own transport and send the redeem URL.
  if (IS_DEV) {
    infoLog(
      "magic-link-email",
      `[DEV] magic-link URL for ${maskEmail(args.email)}: ${args.redeemUrl} (expires ${args.expiresAt.toISOString()})`,
    );
    return;
  }
  // Production: caller wires a transport. If none is configured we no-op
  // so the request still returns 200 (the user will retry; operators see
  // the warning).
  warnLog(
    "magic-link-email",
    "no email transport configured in production — magic link not delivered",
  );
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
