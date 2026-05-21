/**
 * Magic-link email transport.
 *
 * Shared by `/api/auth/magic-link/request` (sign-in) and any downstream
 * surface that also mints magic links (cloud signup, ops-side invite
 * resend, etc.). Each call resolves the configured transport from env,
 * sends the email, and returns success/failure synchronously — callers
 * can decide whether to await or fire-and-forget.
 *
 * Transport selection:
 *
 *   - `SMTP_HOST` + `SMTP_PORT` set → SMTP via nodemailer. Optional
 *     auth via `SMTP_USER` + `SMTP_PASS`. Optional `SMTP_SECURE`
 *     overrides the auto-derived (port-465-implies-tls) default.
 *   - `MAIL_TRANSPORT=noop` → explicit no-op. Returns success without
 *     sending. Useful for CI smoke tests that exercise the call site
 *     without requiring a real SMTP server.
 *   - `VF_MAGIC_LINK_TRANSPORT=<anything>` → operator escape hatch
 *     for transports wired by a sidecar that intercepts the warn-log
 *     line. The mailer no-ops in that mode and trusts the sidecar to
 *     deliver the link out-of-band.
 *   - Nothing set → no-op with an explicit warn-log so an operator
 *     debugging "user never got the email" sees the line in their
 *     application logs.
 *
 * From address: `MAIL_FROM` (recommended) or `SMTP_FROM` or
 * `noreply@<resolved-host-domain>`. The host fallback uses the
 * `noreply@...` convention so a smoke deploy without `MAIL_FROM`
 * still emits a routable address.
 *
 * Why not the channel `nodemailer.createTransport()` already used by
 * `src/server/services/channels/email.ts`?
 *
 *   That driver takes its SMTP config from the per-channel `config`
 *   row (operator-configured alert channel). Magic-link delivery is
 *   stamp-wide and needs to work BEFORE any channels are configured,
 *   so it reads the deployment-level env vars directly.
 */

import { infoLog, warnLog, errorLog } from "@/lib/logger";

export interface SendMagicLinkArgs {
  email: string;
  redeemUrl: string;
  expiresAt: Date;
}

export interface SendMagicLinkResult {
  /**
   * `true` when a transport accepted the message. `false` when no
   * transport is configured, or when the configured transport
   * failed. Magic-link routes always return 200 to the user
   * regardless (anti-enumeration), so this flag is for logs/audit
   * only.
   */
  ok: boolean;
  transport:
    | "smtp"
    | "noop"
    | "log"
    | "external"
    | "unconfigured";
  /** Transport-specific id (smtp messageId) when present. */
  messageId?: string;
  error?: string;
}

/**
 * Send the magic-link redeem URL to `args.email`. Resolves the
 * configured transport from env on every call (no module-load
 * caching) so an operator can change `SMTP_*` and recycle the process
 * to pick up the new transport.
 */
export async function sendMagicLinkEmail(
  args: SendMagicLinkArgs,
): Promise<SendMagicLinkResult> {
  const isDev = process.env.NODE_ENV !== "production";

  // Dev convenience: always log the URL so operators iterating
  // locally do not need to wire SMTP just to test signup. Still
  // attempts the configured transport below if one is present.
  if (isDev) {
    infoLog(
      "magic-link-email",
      `[DEV] magic-link URL for ${maskEmail(args.email)}: ${args.redeemUrl} (expires ${args.expiresAt.toISOString()})`,
    );
  }

  // External transport opt-out — operator wires the link via a
  // sidecar that scrapes the warn-log line. We treat this as a
  // success because the deployment OWNS the side-channel delivery.
  if (process.env.VF_MAGIC_LINK_TRANSPORT) {
    warnLog(
      "magic-link-email",
      `magic-link URL handed to external transport for ${maskEmail(args.email)}`,
    );
    return { ok: true, transport: "external" };
  }

  const mailTransport = (process.env.MAIL_TRANSPORT ?? "").toLowerCase();
  if (mailTransport === "noop") {
    return { ok: true, transport: "noop" };
  }

  const smtpHost = process.env.SMTP_HOST;
  const smtpPortRaw = process.env.SMTP_PORT;
  const smtpPort = smtpPortRaw ? Number.parseInt(smtpPortRaw, 10) : NaN;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = pickFromAddress(args.email);
  const smtpSecureEnv = process.env.SMTP_SECURE;

  if (!smtpHost || !Number.isFinite(smtpPort) || smtpPort <= 0 || smtpPort > 65535) {
    if (isDev) {
      // Already logged the URL above; staying quiet here keeps the
      // dev log tidy.
      return { ok: true, transport: "log" };
    }
    warnLog(
      "magic-link-email",
      `no SMTP transport configured (SMTP_HOST / SMTP_PORT) — magic link for ${maskEmail(args.email)} was not delivered`,
    );
    return {
      ok: false,
      transport: "unconfigured",
      error: "SMTP transport not configured",
    };
  }

  const secure =
    smtpSecureEnv === "true"
      ? true
      : smtpSecureEnv === "false"
        ? false
        : smtpPort === 465;

  try {
    // Lazy-load nodemailer so OSS builds that never send magic links
    // do not pull the transport into the cold-start dependency graph.
    const nodemailerMod = await import("nodemailer");
    const transporter = nodemailerMod.default.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure,
      ...(smtpUser && smtpPass
        ? { auth: { user: smtpUser, pass: smtpPass } }
        : {}),
    });

    const expiryMin = Math.round(
      (args.expiresAt.getTime() - Date.now()) / 60000,
    );
    const subject = "Sign in to VectorFlow";
    const text = renderText(args, expiryMin);
    const html = renderHtml(args, expiryMin);

    const result = await transporter.sendMail({
      from: smtpFrom,
      to: args.email,
      subject,
      text,
      html,
    });

    infoLog(
      "magic-link-email",
      `magic link delivered via SMTP to ${maskEmail(args.email)} messageId=${result.messageId}`,
    );
    return {
      ok: true,
      transport: "smtp",
      messageId: typeof result.messageId === "string" ? result.messageId : undefined,
    };
  } catch (err) {
    errorLog("magic-link-email", "SMTP send failed", err);
    return {
      ok: false,
      transport: "smtp",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function pickFromAddress(recipient: string): string {
  const explicit = process.env.MAIL_FROM ?? process.env.SMTP_FROM;
  if (explicit && explicit.trim().length > 0) return explicit.trim();
  // Synthesise a `noreply@<domain>` based on the recipient's domain.
  // Not ideal (the From should match the deployment's own domain) but
  // a deliverable placeholder until the operator sets MAIL_FROM. SMTP
  // relays that enforce SPF will reject this and surface in logs.
  const at = recipient.indexOf("@");
  const domain = at > 0 ? recipient.slice(at + 1) : "example.invalid";
  return `noreply@${domain}`;
}

function renderText(args: SendMagicLinkArgs, expiryMin: number): string {
  return [
    "Sign in to VectorFlow",
    "",
    `Click the link below to sign in. It expires in ${expiryMin} minute${expiryMin === 1 ? "" : "s"}.`,
    "",
    args.redeemUrl,
    "",
    "If you did not request this, you can ignore this email — the link can only be used once and will expire shortly.",
  ].join("\n");
}

function renderHtml(args: SendMagicLinkArgs, expiryMin: number): string {
  const url = escapeAttr(args.redeemUrl);
  return [
    "<!doctype html>",
    '<html><body style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;">',
    "<h2>Sign in to VectorFlow</h2>",
    `<p>Click the button below to sign in. The link expires in ${expiryMin} minute${expiryMin === 1 ? "" : "s"}.</p>`,
    `<p><a href="${url}" style="display:inline-block;background:#0f172a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:14px;">Sign in</a></p>`,
    `<p style="color:#64748b;font-size:12px;">If the button doesn't work, paste this URL into your browser:</p>`,
    `<p style="word-break:break-all;color:#64748b;font-size:12px;">${url}</p>`,
    `<p style="color:#64748b;font-size:12px;margin-top:24px;">If you did not request this, you can ignore this email — the link can only be used once and will expire shortly.</p>`,
    "</body></html>",
  ].join("");
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function maskEmail(s: string): string {
  const at = s.indexOf("@");
  if (at <= 0) return "***";
  const local = s.slice(0, at);
  const domain = s.slice(at);
  return `${local[0]}***${local[local.length - 1] ?? ""}${domain}`;
}
