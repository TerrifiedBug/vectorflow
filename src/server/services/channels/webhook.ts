import crypto from "crypto";
import type { ChannelDriver, ChannelPayload, ChannelDeliveryResult } from "./types";
import { validatePublicUrl } from "@/server/services/url-validation";
import { formatWebhookMessage } from "@/server/services/webhook-delivery";

export const webhookDriver: ChannelDriver = {
  async deliver(
    config: Record<string, unknown>,
    payload: ChannelPayload,
  ): Promise<ChannelDeliveryResult> {
    const url = config.url as string;
    if (!url) {
      return { channelId: "", success: false, error: "Missing url in config" };
    }

    try {
      await validatePublicUrl(url);
    } catch (err) {
      return {
        channelId: "",
        success: false,
        error: err instanceof Error ? err.message : "URL validation failed",
      };
    }

    const outgoing = {
      ...payload,
      content: formatWebhookMessage(payload),
    };

    const body = JSON.stringify(outgoing);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((config.headers as Record<string, string>) ?? {}),
    };

    const hmacSecret = config.hmacSecret as string | undefined;
    if (hmacSecret) {
      const signature = crypto
        .createHmac("sha256", hmacSecret)
        .update(body)
        .digest("hex");
      headers["X-VectorFlow-Signature"] = `sha256=${signature}`;
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        return {
          channelId: "",
          success: false,
          error: `Webhook returned ${res.status} ${res.statusText}`,
        };
      }

      return { channelId: "", success: true };
    } catch (err) {
      return {
        channelId: "",
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
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
      message: "CPU usage is 85.50 (threshold: > 80)",
      timestamp: new Date().toISOString(),
      dashboardUrl: `${process.env.NEXTAUTH_URL ?? ""}/alerts`,
    };

    return this.deliver(config, testPayload);
  },
};
