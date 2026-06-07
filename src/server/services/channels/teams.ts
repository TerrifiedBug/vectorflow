import type { ChannelDriver, ChannelPayload, ChannelDeliveryResult } from "./types";
import { fetchHardened } from "@/server/services/webhook-hardened-delivery";

/**
 * Build a Microsoft Teams MessageCard payload. MessageCard is the format
 * accepted by classic Incoming Webhook connectors. (Teams Workflows webhooks
 * expect an Adaptive Card instead — not supported by this driver yet.)
 */
function buildTeamsCard(payload: ChannelPayload) {
  const firing = payload.status === "firing";

  const facts: Array<{ name: string; value: string }> = [
    { name: "Status", value: firing ? "🔴 FIRING" : "✅ RESOLVED" },
    { name: "Severity", value: payload.severity },
    { name: "Environment", value: payload.environment },
    {
      name: "Metric",
      value: `${payload.metric} = ${payload.value} (threshold ${payload.threshold})`,
    },
  ];
  if (payload.pipeline) facts.push({ name: "Pipeline", value: payload.pipeline });
  if (payload.node) facts.push({ name: "Node", value: payload.node });
  if (payload.team) facts.push({ name: "Team", value: payload.team });
  if (payload.suggestedAction) {
    facts.push({ name: "Suggested action", value: payload.suggestedAction });
  }

  return {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    themeColor: firing ? "D7263D" : "2EB67D",
    summary: `${firing ? "FIRING" : "RESOLVED"}: ${payload.ruleName}`,
    sections: [
      {
        activityTitle: `${firing ? "🔴 FIRING" : "✅ RESOLVED"}: ${payload.ruleName}`,
        activitySubtitle: payload.message,
        facts,
        markdown: true,
      },
    ],
    potentialAction: payload.dashboardUrl
      ? [
          {
            "@type": "OpenUri",
            name: "View in VectorFlow",
            targets: [{ os: "default", uri: payload.dashboardUrl }],
          },
        ]
      : [],
  };
}

export const teamsDriver: ChannelDriver = {
  async deliver(
    config: Record<string, unknown>,
    payload: ChannelPayload,
  ): Promise<ChannelDeliveryResult> {
    const webhookUrl = config.webhookUrl as string;
    if (!webhookUrl) {
      return { channelId: "", success: false, error: "Missing webhookUrl in config" };
    }

    const body = JSON.stringify(buildTeamsCard(payload));

    try {
      const res = await fetchHardened(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        return {
          channelId: "",
          success: false,
          error: `Teams webhook returned ${res.status}`,
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
