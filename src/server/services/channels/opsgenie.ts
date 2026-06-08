import { validateOutboundUrl } from "@/server/services/url-validation";
import type { ChannelDriver, ChannelPayload, ChannelDeliveryResult } from "./types";

// Opsgenie Alerts API base URLs, keyed by data-residency region.
const OPSGENIE_REGION_URLS: Record<string, string> = {
  us: "https://api.opsgenie.com/v2/alerts",
  eu: "https://api.eu.opsgenie.com/v2/alerts",
};

// Map VectorFlow severities → Opsgenie priorities (P1 highest … P5 lowest).
const DEFAULT_PRIORITY_MAP: Record<string, string> = {
  critical: "P1",
  error: "P2",
  high: "P2",
  warning: "P3",
  info: "P5",
};

// Opsgenie rejects alert messages longer than 130 characters.
const OPSGENIE_MESSAGE_MAX = 130;

function buildTags(payload: ChannelPayload): string[] {
  const tags = [
    "vectorflow",
    `severity:${payload.severity}`,
    `env:${payload.environment}`,
    `metric:${payload.metric}`,
  ];
  if (payload.pipeline) tags.push(`pipeline:${payload.pipeline}`);
  if (payload.node) tags.push(`node:${payload.node}`);
  if (payload.team) tags.push(`team:${payload.team}`);
  return tags;
}

function buildDescription(payload: ChannelPayload): string {
  const lines = [
    payload.message,
    "",
    `Severity: ${payload.severity}`,
    `Environment: ${payload.environment}`,
    `Metric: ${payload.metric} = ${payload.value} (threshold ${payload.threshold})`,
  ];
  if (payload.pipeline) lines.push(`Pipeline: ${payload.pipeline}`);
  if (payload.node) lines.push(`Node: ${payload.node}`);
  if (payload.team) lines.push(`Team: ${payload.team}`);
  if (payload.suggestedAction) lines.push(`Suggested action: ${payload.suggestedAction}`);
  if (payload.dashboardUrl) lines.push(`Dashboard: ${payload.dashboardUrl}`);
  return lines.join("\n");
}

export const opsgenieDriver: ChannelDriver = {
  async deliver(
    config: Record<string, unknown>,
    payload: ChannelPayload,
  ): Promise<ChannelDeliveryResult> {
    const apiKey = config.apiKey as string;
    if (!apiKey) {
      return { channelId: "", success: false, error: "Missing apiKey in config" };
    }

    const region = (config.region as string) === "eu" ? "eu" : "us";
    const baseUrl = OPSGENIE_REGION_URLS[region];

    const priorityMap = {
      ...DEFAULT_PRIORITY_MAP,
      ...((config.priorityMap as Record<string, string>) ?? {}),
    };
    const priority = priorityMap[payload.severity] ?? "P3";

    // Stable alias = dedup key, so repeated firings collapse onto a single
    // Opsgenie alert and a later "resolved" closes that same alert.
    const alias = `vectorflow-${payload.alertId}`;

    const resolved = payload.status === "resolved";

    // Firing → create an alert; resolved → close the correlated alert by alias.
    const url = resolved
      ? `${baseUrl}/${encodeURIComponent(alias)}/close?identifierType=alias`
      : baseUrl;

    const body = resolved
      ? JSON.stringify({ source: "VectorFlow", note: payload.message })
      : JSON.stringify({
          message: `${payload.ruleName}: ${payload.message}`.slice(0, OPSGENIE_MESSAGE_MAX),
          description: buildDescription(payload),
          alias,
          priority,
          tags: buildTags(payload),
          source: "VectorFlow",
          details: {
            metric: payload.metric,
            value: String(payload.value),
            threshold: String(payload.threshold),
            environment: payload.environment,
            ...(payload.pipeline ? { pipeline: payload.pipeline } : {}),
            ...(payload.node ? { node: payload.node } : {}),
            ...(payload.team ? { team: payload.team } : {}),
            ...(payload.dashboardUrl ? { dashboardUrl: payload.dashboardUrl } : {}),
          },
        });

    // SSRF guard mirrors pagerduty: the Opsgenie endpoint is hardcoded, but the
    // request still leaves the control plane, so validate defensively (force) —
    // a future config-driven region inherits the unified outbound policy.
    try {
      await validateOutboundUrl(url, { force: true });
    } catch (err) {
      return {
        channelId: "",
        success: false,
        error: `Outbound URL rejected: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `GenieKey ${apiKey}`,
        },
        body,
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          channelId: "",
          success: false,
          error: `Opsgenie returned ${res.status}: ${text}`,
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
    // Mirror PagerDuty: page a test alert, then immediately close it.
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

    // Immediately resolve (close)
    const resolvePayload = { ...testPayload, status: "resolved" as const };
    return this.deliver(config, resolvePayload);
  },
};
