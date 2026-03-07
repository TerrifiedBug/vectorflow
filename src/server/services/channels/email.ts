import nodemailer from "nodemailer";
import type { ChannelDriver, ChannelPayload, ChannelDeliveryResult } from "./types";

function buildHtml(payload: ChannelPayload): string {
  const statusColor = payload.status === "firing" ? "#dc2626" : "#16a34a";
  const statusLabel = payload.status === "firing" ? "FIRING" : "RESOLVED";
  const statusEmoji = payload.status === "firing" ? "\ud83d\udd34" : "\u2705";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f4f4f5;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <div style="background: ${statusColor}; color: white; padding: 16px 24px;">
      <h1 style="margin: 0; font-size: 18px;">${statusEmoji} Alert ${statusLabel}: ${payload.ruleName}</h1>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #374151; font-size: 15px;">${payload.message}</p>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 8px 0; color: #6b7280; width: 120px;">Metric</td><td style="padding: 8px 0; color: #111827;">${payload.metric}</td></tr>
        <tr><td style="padding: 8px 0; color: #6b7280;">Value</td><td style="padding: 8px 0; color: #111827;">${payload.value.toFixed(2)}</td></tr>
        <tr><td style="padding: 8px 0; color: #6b7280;">Threshold</td><td style="padding: 8px 0; color: #111827;">${payload.threshold}</td></tr>
        <tr><td style="padding: 8px 0; color: #6b7280;">Severity</td><td style="padding: 8px 0; color: #111827;">${payload.severity}</td></tr>
        <tr><td style="padding: 8px 0; color: #6b7280;">Environment</td><td style="padding: 8px 0; color: #111827;">${payload.environment}</td></tr>
        ${payload.node ? `<tr><td style="padding: 8px 0; color: #6b7280;">Node</td><td style="padding: 8px 0; color: #111827;">${payload.node}</td></tr>` : ""}
        ${payload.pipeline ? `<tr><td style="padding: 8px 0; color: #6b7280;">Pipeline</td><td style="padding: 8px 0; color: #111827;">${payload.pipeline}</td></tr>` : ""}
        ${payload.team ? `<tr><td style="padding: 8px 0; color: #6b7280;">Team</td><td style="padding: 8px 0; color: #111827;">${payload.team}</td></tr>` : ""}
        <tr><td style="padding: 8px 0; color: #6b7280;">Time</td><td style="padding: 8px 0; color: #111827;">${payload.timestamp}</td></tr>
      </table>
      <div style="margin-top: 24px;">
        <a href="${payload.dashboardUrl}" style="display: inline-block; background: ${statusColor}; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px;">View in Dashboard</a>
      </div>
    </div>
  </div>
</body>
</html>`.trim();
}

export const emailDriver: ChannelDriver = {
  async deliver(
    config: Record<string, unknown>,
    payload: ChannelPayload,
  ): Promise<ChannelDeliveryResult> {
    const smtpHost = config.smtpHost as string;
    const smtpPort = config.smtpPort as number;
    const smtpUser = config.smtpUser as string | undefined;
    const smtpPass = config.smtpPass as string | undefined;
    const from = config.from as string;
    const recipients = config.recipients as string[];

    if (!smtpHost || !smtpPort || !from || !recipients?.length) {
      return {
        channelId: "",
        success: false,
        error: "Missing required email config (smtpHost, smtpPort, from, recipients)",
      };
    }

    const statusLabel = payload.status === "firing" ? "FIRING" : "RESOLVED";
    const subject = `[VectorFlow] Alert ${statusLabel}: ${payload.ruleName}`;

    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        ...(smtpUser && smtpPass
          ? { auth: { user: smtpUser, pass: smtpPass } }
          : {}),
      });

      await transporter.sendMail({
        from,
        to: recipients.join(", "),
        subject,
        html: buildHtml(payload),
      });

      return { channelId: "", success: true };
    } catch (err) {
      return {
        channelId: "",
        success: false,
        error: err instanceof Error ? err.message : "Unknown email error",
      };
    }
  },

  async test(config: Record<string, unknown>): Promise<ChannelDeliveryResult> {
    const testPayload: ChannelPayload = {
      alertId: "test-alert-id",
      status: "firing",
      ruleName: "Test Alert Rule",
      severity: "warning",
      environment: "Test Environment",
      node: "test-node.example.com",
      metric: "cpu_usage",
      value: 85.5,
      threshold: 80,
      message: "This is a test alert from VectorFlow.",
      timestamp: new Date().toISOString(),
      dashboardUrl: `${process.env.NEXTAUTH_URL ?? ""}/alerts`,
    };

    return this.deliver(config, testPayload);
  },
};
