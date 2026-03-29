import { prisma } from "@/lib/prisma";
import type { AlertRule, AlertEvent } from "@/generated/prisma";
import { checkCondition, FLEET_METRICS } from "@/server/services/alert-evaluator";
import type { ChannelPayload } from "@/server/services/channels/types";
import { deliverToChannels } from "@/server/services/channels";
import { deliverSingleWebhook } from "@/server/services/webhook-delivery";
import { trackWebhookDelivery } from "@/server/services/delivery-tracking";
import {
  getFleetErrorRate,
  getFleetEventVolume,
  getFleetThroughputDrop,
  getNodeLoadImbalance,
} from "@/server/services/fleet-metrics";
import type { LoadImbalanceResult } from "@/server/services/fleet-metrics";
import { getVersionDrift } from "@/server/services/drift-metrics";

// Re-export the constant for downstream use (e.g. T03 validation)
export { FLEET_METRICS } from "@/server/services/alert-evaluator";

// ─── Constants ──────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000;

// ─── Types ──────────────────────────────────────────────────────────────────

interface FiredFleetAlertEvent {
  event: AlertEvent;
  rule: AlertRule & {
    environment: { name: string; team: { name: string } | null };
  };
  /** For node_load_imbalance: the host of the most imbalanced node */
  nodeHost?: string;
}

// ─── FleetAlertService ──────────────────────────────────────────────────────

export class FleetAlertService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private conditionFirstSeen = new Map<string, Date>();

  init(): void {
    console.log("[fleet-alert-service] Initializing...");
    this.start();
  }

  start(): void {
    this.timer = setInterval(
      () => void this.evaluateFleetAlerts(),
      POLL_INTERVAL_MS,
    );
    this.timer.unref();
    console.log(
      `[fleet-alert-service] Poll loop started (every ${POLL_INTERVAL_MS / 1000}s)`,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[fleet-alert-service] Poll loop stopped");
    }
  }

  /**
   * Core poll loop: queries all enabled fleet-metric alert rules, evaluates
   * each against current metric values, and fires or resolves alert events.
   */
  async evaluateFleetAlerts(): Promise<FiredFleetAlertEvent[]> {
    const results: FiredFleetAlertEvent[] = [];

    try {
      // Query all enabled, non-snoozed fleet-metric alert rules
      const rules = await prisma.alertRule.findMany({
        where: {
          enabled: true,
          metric: { in: Array.from(FLEET_METRICS) },
          AND: [
            {
              OR: [
                { snoozedUntil: null },
                { snoozedUntil: { lt: new Date() } },
              ],
            },
          ],
        },
        include: {
          environment: {
            select: { name: true, team: { select: { name: true } } },
          },
        },
      });

      for (const rule of rules) {
        try {
          const result = await this.evaluateRule(rule);
          if (result) results.push(result);
        } catch (err) {
          // Per-rule isolation: one rule's failure must not stop others
          console.error(
            `[fleet-alert-service] Error evaluating rule ${rule.id} (${rule.metric}):`,
            err,
          );
        }
      }

      // Deliver notifications for all fired/resolved events
      await this.deliverAlerts(results);
    } catch (err) {
      console.error("[fleet-alert-service] Poll loop error:", err);
    }

    return results;
  }

  /**
   * Evaluate a single fleet-metric alert rule.
   * Returns a FiredFleetAlertEvent if the rule fires or resolves, null otherwise.
   */
  private async evaluateRule(
    rule: AlertRule & {
      environment: { name: string; team: { name: string } | null };
    },
  ): Promise<FiredFleetAlertEvent | null> {
    if (!rule.condition || rule.threshold == null) return null;

    // Compute the metric value
    const metricResult = await this.readFleetMetric(
      rule.metric as (typeof FLEET_METRICS extends Set<infer T> ? T : never),
      rule.environmentId,
    );

    // Extract numeric value and optional nodeId
    let value: number | null;
    let imbalanceNodeId: string | null = null;

    if (metricResult !== null && typeof metricResult === "object" && "value" in metricResult) {
      // LoadImbalanceResult
      value = (metricResult as LoadImbalanceResult).value;
      imbalanceNodeId = (metricResult as LoadImbalanceResult).nodeId;
    } else {
      value = metricResult as number | null;
    }

    if (value === null) {
      // No data — clear duration tracking
      this.conditionFirstSeen.delete(rule.id);
      return null;
    }

    const conditionMet = checkCondition(value, rule.condition, rule.threshold);
    const now = new Date();

    if (conditionMet) {
      // Track when the condition was first seen
      if (!this.conditionFirstSeen.has(rule.id)) {
        this.conditionFirstSeen.set(rule.id, now);
      }

      const firstSeen = this.conditionFirstSeen.get(rule.id)!;
      const elapsedSeconds = (now.getTime() - firstSeen.getTime()) / 1000;

      // Only fire if the condition has persisted for the required duration
      if (elapsedSeconds >= (rule.durationSeconds ?? 0)) {
        // Check if there is already an open event for this rule
        const existingEvent = await prisma.alertEvent.findFirst({
          where: {
            alertRuleId: rule.id,
            status: { in: ["firing", "acknowledged"] },
            resolvedAt: null,
          },
          orderBy: { firedAt: "desc" },
        });

        if (!existingEvent) {
          const message = this.buildMessage(rule, value);
          const nodeId = rule.metric === "node_load_imbalance"
            ? imbalanceNodeId
            : null;

          const event = await prisma.alertEvent.create({
            data: {
              alertRuleId: rule.id,
              nodeId,
              status: "firing",
              value,
              message,
            },
          });

          // Look up host for node_load_imbalance
          let nodeHost: string | undefined;
          if (nodeId) {
            const node = await prisma.vectorNode.findUnique({
              where: { id: nodeId },
              select: { host: true },
            });
            nodeHost = node?.host ?? undefined;
          }

          return { event, rule, nodeHost };
        }
      }
    } else {
      // Condition no longer met — clear duration tracking
      this.conditionFirstSeen.delete(rule.id);

      // Resolve any open firing or acknowledged event
      const openEvent = await prisma.alertEvent.findFirst({
        where: {
          alertRuleId: rule.id,
          status: { in: ["firing", "acknowledged"] },
          resolvedAt: null,
        },
        orderBy: { firedAt: "desc" },
      });

      if (openEvent) {
        const resolved = await prisma.alertEvent.update({
          where: { id: openEvent.id },
          data: {
            status: "resolved",
            resolvedAt: now,
          },
        });

        return { event: resolved, rule };
      }
    }

    return null;
  }

  /**
   * Read the current value for a fleet metric.
   * Returns a number, LoadImbalanceResult, or null.
   */
  private async readFleetMetric(
    metric: string,
    environmentId: string,
  ): Promise<number | LoadImbalanceResult | null> {
    switch (metric) {
      case "fleet_error_rate":
        return getFleetErrorRate(environmentId);
      case "fleet_event_volume":
        return getFleetEventVolume(environmentId);
      case "fleet_throughput_drop":
        return getFleetThroughputDrop(environmentId);
      case "node_load_imbalance":
        return getNodeLoadImbalance(environmentId);
      case "version_drift": {
        const drift = await getVersionDrift(environmentId);
        if (drift === null) return null;
        return drift.value;
      }
      default:
        return null;
    }
  }

  /**
   * Build a human-readable message for a fleet alert event.
   */
  private buildMessage(rule: AlertRule, value: number): string {
    const METRIC_LABELS: Record<string, string> = {
      fleet_error_rate: "Fleet error rate",
      fleet_throughput_drop: "Fleet throughput drop",
      fleet_event_volume: "Fleet event volume",
      node_load_imbalance: "Node load imbalance",
      version_drift: "Version drift",
    };

    const CONDITION_LABELS: Record<string, string> = {
      gt: ">",
      lt: "<",
      eq: "=",
    };

    const metricLabel = METRIC_LABELS[rule.metric] ?? rule.metric;
    const condLabel = CONDITION_LABELS[rule.condition ?? ""] ?? rule.condition;

    return `${metricLabel} at ${value.toFixed(2)} (threshold: ${condLabel} ${rule.threshold})`;
  }

  /**
   * Deliver notifications for fired/resolved fleet alert events.
   */
  private async deliverAlerts(
    events: FiredFleetAlertEvent[],
  ): Promise<void> {
    for (const { event, rule, nodeHost } of events) {
      try {
        const payload: ChannelPayload = {
          alertId: event.id,
          status: event.status as "firing" | "resolved",
          ruleName: rule.name,
          severity: "warning",
          environment: rule.environment.name,
          team: rule.environment.team?.name,
          node: nodeHost,
          pipeline: undefined,
          metric: rule.metric,
          value: event.value,
          threshold: rule.threshold ?? 0,
          message: event.message ?? "",
          timestamp: event.firedAt.toISOString(),
          dashboardUrl: `${process.env.NEXTAUTH_URL ?? ""}/alerts`,
        };

        // Deliver to legacy webhooks with delivery tracking
        const webhooks = await prisma.alertWebhook.findMany({
          where: { environmentId: rule.environmentId, enabled: true },
        });
        for (const webhook of webhooks) {
          trackWebhookDelivery(
            event.id,
            webhook.id,
            webhook.url,
            () => deliverSingleWebhook(webhook, payload),
          ).catch((err) =>
            console.error(
              `[fleet-alert-service] Webhook delivery error for ${webhook.url}:`,
              err,
            ),
          );
        }

        // Deliver to notification channels with delivery tracking
        deliverToChannels(
          rule.environmentId,
          rule.id,
          payload,
          event.id,
        ).catch((err) =>
          console.error(
            "[fleet-alert-service] Channel delivery error:",
            err,
          ),
        );
      } catch (err) {
        console.error(
          `[fleet-alert-service] Delivery error for event ${event.id}:`,
          err,
        );
      }
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const fleetAlertService = new FleetAlertService();

export function initFleetAlertService(): void {
  fleetAlertService.init();
}
