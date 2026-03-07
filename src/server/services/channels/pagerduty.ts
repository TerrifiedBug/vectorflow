import type { ChannelDriver, ChannelPayload, ChannelDeliveryResult } from "./types";

const PAGERDUTY_EVENTS_URL = "https://events.pagerduty.com/v2/enqueue";

const DEFAULT_SEVERITY_MAP: Record<string, string> = {
  critical: "critical",
  warning: "warning",
  info: "info",
};

export const pagerdutyDriver: ChannelDriver = {
  async deliver(
    config: Record<string, unknown>,
    payload: ChannelPayload,
  ): Promise<ChannelDeliveryResult> {
    const integrationKey = config.integrationKey as string;
    if (!integrationKey) {
      return {
        channelId: "",
        success: false,
        error: "Missing integrationKey in config",
      };
    }

    const severityMap = {
      ...DEFAULT_SEVERITY_MAP,
      ...((config.severityMap as Record<string, string>) ?? {}),
    };

    const pdSeverity = severityMap[payload.severity] ?? "warning";

    // Use alertId as dedup_key for PagerDuty incident correlation
    const dedupKey = `vectorflow-${payload.alertId}`;

    const eventAction = payload.status === "firing" ? "trigger" : "resolve";

    const pdPayload: Record<string, unknown> = {
      routing_key: integrationKey,
      dedup_key: dedupKey,
      event_action: eventAction,
    };

    if (eventAction === "trigger") {
      pdPayload.payload = {
        summary: `${payload.ruleName}: ${payload.message}`,
        severity: pdSeverity,
        source: payload.node ?? payload.environment,
        component: payload.pipeline ?? undefined,
        group: payload.environment,
        class: payload.metric,
        timestamp: payload.timestamp,
        custom_details: {
          metric: payload.metric,
          value: payload.value,
          threshold: payload.threshold,
          environment: payload.environment,
          team: payload.team,
          node: payload.node,
          pipeline: payload.pipeline,
          dashboardUrl: payload.dashboardUrl,
        },
      };
      pdPayload.links = [
        {
          href: payload.dashboardUrl,
          text: "View in VectorFlow Dashboard",
        },
      ];
    }

    try {
      const res = await fetch(PAGERDUTY_EVENTS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pdPayload),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          channelId: "",
          success: false,
          error: `PagerDuty returned ${res.status}: ${text}`,
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
    // For PagerDuty, we trigger and immediately resolve a test event
    const testPayload: ChannelPayload = {
      alertId: `test-${Date.now()}`,
      status: "firing",
      ruleName: "VectorFlow Test Alert",
      severity: "info",
      environment: "Test Environment",
      node: "test-node.example.com",
      metric: "cpu_usage",
      value: 85.5,
      threshold: 80,
      message: "This is a test alert from VectorFlow. It will auto-resolve.",
      timestamp: new Date().toISOString(),
      dashboardUrl: `${process.env.NEXTAUTH_URL ?? ""}/alerts`,
    };

    // Trigger
    const triggerResult = await this.deliver(config, testPayload);
    if (!triggerResult.success) return triggerResult;

    // Immediately resolve
    const resolvePayload = { ...testPayload, status: "resolved" as const };
    return this.deliver(config, resolvePayload);
  },
};
