import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export interface WebhookPayload {
  alertId: string;
  status: "firing" | "resolved";
  ruleName: string;
  severity: string;
  environment: string;
  team?: string;
  node?: string;
  pipeline?: string;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  timestamp: string;
  dashboardUrl: string;
}

/**
 * Format a webhook payload as a human-readable string.
 */
export function formatWebhookMessage(payload: WebhookPayload): string {
  const icon = payload.status === "firing" ? "🚨" : "✅";
  const status = payload.status === "firing" ? "FIRING" : "RESOLVED";
  const lines = [
    `${icon} **Alert ${status}: ${payload.ruleName}**`,
    `> ${payload.message}`,
    "",
  ];
  if (payload.node) lines.push(`**Node:** ${payload.node}`);
  if (payload.pipeline) lines.push(`**Pipeline:** ${payload.pipeline}`);
  lines.push(`**Environment:** ${payload.environment}`);
  if (payload.team) lines.push(`**Team:** ${payload.team}`);
  lines.push(`**Time:** ${payload.timestamp}`);
  if (payload.dashboardUrl) lines.push(`**Dashboard:** ${payload.dashboardUrl}`);
  return lines.join("\n");
}

export async function deliverWebhooks(
  environmentId: string,
  payload: WebhookPayload,
): Promise<void> {
  const webhooks = await prisma.alertWebhook.findMany({
    where: { environmentId, enabled: true },
  });

  for (const webhook of webhooks) {
    // Always include a `content` field with a human-readable summary.
    // Chat platforms (Discord, Slack, etc.) use this field; generic
    // consumers can ignore it and read the structured fields instead.
    const outgoing = {
      ...payload,
      content: formatWebhookMessage(payload),
    };

    const body = JSON.stringify(outgoing);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((webhook.headers as Record<string, string>) ?? {}),
    };

    if (webhook.hmacSecret) {
      const signature = crypto
        .createHmac("sha256", webhook.hmacSecret)
        .update(body)
        .digest("hex");
      headers["X-VectorFlow-Signature"] = `sha256=${signature}`;
    }

    try {
      const res = await fetch(webhook.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.error(
          `Webhook delivery failed to ${webhook.url}: ${res.status}`,
        );
      }
    } catch (err) {
      console.error(`Webhook delivery error to ${webhook.url}:`, err);
    }
  }
}
