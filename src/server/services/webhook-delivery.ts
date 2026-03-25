import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { validatePublicUrl } from "@/server/services/url-validation";

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

export interface SingleWebhookResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * Deliver a payload to a single webhook. Returns a structured result
 * indicating success/failure, HTTP status code, and any error message.
 */
export async function deliverSingleWebhook(
  webhook: {
    url: string;
    headers: unknown;
    hmacSecret: string | null;
  },
  payload: WebhookPayload,
): Promise<SingleWebhookResult> {
  // SSRF protection: validate webhook URL resolves to a public IP
  try {
    await validatePublicUrl(webhook.url);
  } catch {
    return {
      success: false,
      error: `Skipped: private/reserved IP for ${webhook.url}`,
    };
  }

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
      return {
        success: false,
        statusCode: res.status,
        error: `HTTP ${res.status}`,
      };
    }

    return { success: true, statusCode: res.status };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown webhook error",
    };
  }
}

/**
 * Deliver a payload to all enabled webhooks for an environment.
 * Backward-compatible batch wrapper around deliverSingleWebhook.
 */
export async function deliverWebhooks(
  environmentId: string,
  payload: WebhookPayload,
): Promise<void> {
  const webhooks = await prisma.alertWebhook.findMany({
    where: { environmentId, enabled: true },
  });

  for (const webhook of webhooks) {
    const result = await deliverSingleWebhook(webhook, payload);
    if (!result.success) {
      console.error(
        `Webhook delivery failed to ${webhook.url}: ${result.error}`,
      );
    }
  }
}
