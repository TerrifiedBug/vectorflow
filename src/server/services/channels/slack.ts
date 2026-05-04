import type { ChannelDriver, ChannelPayload, ChannelDeliveryResult } from "./types";
import { validatePublicUrl } from "@/server/services/url-validation";

function buildSlackBlocks(payload: ChannelPayload) {
  const statusEmoji = payload.status === "firing" ? "\ud83d\udd34" : "\u2705";
  const statusText = payload.status === "firing" ? "FIRING" : "RESOLVED";

  return {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${statusEmoji} Alert ${statusText}: ${payload.ruleName}`,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `> ${payload.message}`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Metric:*\n${payload.metric}` },
          { type: "mrkdwn", text: `*Value:*\n${payload.value.toFixed(2)}` },
          { type: "mrkdwn", text: `*Threshold:*\n${payload.threshold}` },
          { type: "mrkdwn", text: `*Severity:*\n${payload.severity}` },
          ...(payload.ownerHint
            ? [{ type: "mrkdwn", text: `*Owner:*\n${payload.ownerHint}` }]
            : []),
          { type: "mrkdwn", text: `*Environment:*\n${payload.environment}` },
          ...(payload.node
            ? [{ type: "mrkdwn", text: `*Node:*\n${payload.node}` }]
            : []),
          ...(payload.pipeline
            ? [{ type: "mrkdwn", text: `*Pipeline:*\n${payload.pipeline}` }]
            : []),
          ...(payload.team
            ? [{ type: "mrkdwn", text: `*Team:*\n${payload.team}` }]
            : []),
        ],
      },
      ...(payload.suggestedAction
        ? [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Suggested action:*\n${payload.suggestedAction}`,
              },
            },
          ]
        : []),
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `<${payload.dashboardUrl}|View in Dashboard> | ${payload.timestamp}`,
          },
        ],
      },
    ],
  };
}

export const slackDriver: ChannelDriver = {
  async deliver(
    config: Record<string, unknown>,
    payload: ChannelPayload,
  ): Promise<ChannelDeliveryResult> {
    const webhookUrl = config.webhookUrl as string;
    if (!webhookUrl) {
      return { channelId: "", success: false, error: "Missing webhookUrl in config" };
    }

    try {
      await validatePublicUrl(webhookUrl);
    } catch (err) {
      return {
        channelId: "",
        success: false,
        error: err instanceof Error ? err.message : "URL validation failed",
      };
    }

    const body = JSON.stringify(buildSlackBlocks(payload));

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        return {
          channelId: "",
          success: false,
          error: `Slack webhook returned ${res.status} ${res.statusText}`,
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
