import { prisma } from "@/lib/prisma";
import crypto from "crypto";

interface WebhookPayload {
  alertId: string;
  status: "firing" | "resolved";
  ruleName: string;
  severity: string;
  environment: string;
  pipeline?: string;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  timestamp: string;
  dashboardUrl: string;
}

export async function deliverWebhooks(
  environmentId: string,
  payload: WebhookPayload,
): Promise<void> {
  const webhooks = await prisma.alertWebhook.findMany({
    where: { environmentId, enabled: true },
  });

  for (const webhook of webhooks) {
    const body = JSON.stringify(payload);
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
