import { adminPrisma, prisma } from "@/lib/prisma";
import { runWithOrgContext } from "@/lib/org-context";
import type { AlertRule, AlertEvent } from "@/generated/prisma";
import { checkCondition, FLEET_METRICS } from "@/server/services/alert-evaluator";
import type { ChannelPayload } from "@/server/services/channels/types";
import { deliverToChannels } from "@/server/services/channels";
import {
  getFleetErrorRate,
  getFleetEventVolume,
  getFleetThroughputDrop,
  getFleetThroughputDropDetail,
  getNodeLoadImbalance,
  getPipelineLatencyMean,
  getPipelineThroughputFloor,
} from "@/server/services/fleet-metrics";
import type { LoadImbalanceResult, ThroughputDropDetail } from "@/server/services/fleet-metrics";
import { getVersionDrift } from "@/server/services/drift-metrics";
import { checkCertificateExpiry } from "@/server/services/cert-expiry-checker";
import { evaluateCostAlerts } from "@/server/services/cost-alert";
import { infoLog, errorLog } from "@/lib/logger";

// Re-export the constant for downstream use (e.g. T03 validation)
export { FLEET_METRICS } from "@/server/services/alert-evaluator";

// ─── Constants ──────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000;

// ─── Types ──────────────────────────────────────────────────────────────────

interface FiredFleetAlertEvent {
  event: AlertEvent;
  rule: AlertRule & {
    environment: { name: string; team: { name: string } | null };
    pipeline: { name: string } | null;
  };
  /** For node_load_imbalance: the host of the most imbalanced node */
  nodeHost?: string;
  /** For fleet_throughput_drop: per-pipeline breakdown */
  throughputDetail?: ThroughputDropDetail;
}

// ─── FleetAlertService ──────────────────────────────────────────────────────

export class FleetAlertService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private conditionFirstSeen = new Map<string, Date>();

  /**
   * True while a tick is currently executing. The per-org fan-out can
   * exceed POLL_INTERVAL_MS in fleets with many tenants; setInterval
   * does NOT skip overlapping callbacks, so without this guard two
   * ticks could run concurrently and double-evaluate every rule.
   */
  private tickInFlight = false;

  init(): void {
    infoLog("fleet-alert", "Initializing...");
    this.start();
  }

  start(): void {
    this.timer = setInterval(
      () => void this.tick(),
      POLL_INTERVAL_MS,
    );
    this.timer.unref();
    infoLog("fleet-alert", `Poll loop started (every ${POLL_INTERVAL_MS / 1000}s)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      infoLog("fleet-alert", "Poll loop stopped");
    }
  }

  /**
   * Single tick: iterate orgs and evaluate each one's fleet alerts.
   * Fleet-wide checks (certificate expiry, cost alerts) run once per
   * tick regardless of org count — they're already per-tenant via
   * their own queries.
   */
  private async tick(): Promise<void> {
    if (this.tickInFlight) {
      infoLog(
        "fleet-alert",
        "Previous tick still in flight; skipping this interval to avoid overlap",
      );
      return;
    }
    this.tickInFlight = true;
    try {
      let orgs: Array<{ id: string }>;
      try {
        orgs = await adminPrisma.organization.findMany({
          where: { suspendedAt: null, deletedAt: null },
          select: { id: true },
        });
      } catch (err) {
        errorLog(
          "fleet-alert",
          "Failed to list organizations for tick (skipping this cycle)",
          err,
        );
        return;
      }
      for (const org of orgs) {
        try {
          await runWithOrgContext(org.id, () =>
            this.evaluateFleetAlerts({ organizationId: org.id }),
          );
        } catch (err) {
          errorLog(
            "fleet-alert",
            `org=${org.id} evaluation error (continuing)`,
            err,
          );
        }
      }

      // Fleet-wide checks (not currently per-org). Tracked as a
      // follow-up: checkCertificateExpiry + evaluateCostAlerts could
      // iterate orgs too; current shape continues working because
      // they query their own per-tenant tables internally.
      try {
        await checkCertificateExpiry();
      } catch (certErr) {
        errorLog("fleet-alert", "Certificate expiry check failed", certErr);
      }
      try {
        await evaluateCostAlerts();
      } catch (err) {
        errorLog("fleet-alert", "Cost alert evaluation failed", err);
      }
    } finally {
      this.tickInFlight = false;
    }
  }

  /**
   * Evaluate fleet-metric alert rules and fire/resolve their alert
   * events. When `opts.organizationId` is supplied the query is scoped
   * to that org.
   *
   * Note: certificate-expiry and cost-budget checks moved out to the
   * tick() level so they're not duplicated per org.
   */
  async evaluateFleetAlerts(
    opts: { organizationId?: string } = {},
  ): Promise<FiredFleetAlertEvent[]> {
    const results: FiredFleetAlertEvent[] = [];

    try {
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
          ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
        },
        include: {
          environment: {
            select: { name: true, team: { select: { name: true } } },
          },
          pipeline: {
            select: { name: true },
          },
        },
      });

      for (const rule of rules) {
        try {
          const result = await this.evaluateRule(rule);
          if (result) results.push(result);
        } catch (err) {
          errorLog("fleet-alert", `Error evaluating rule ${rule.id} (${rule.metric})`, err);
        }
      }

      await this.deliverAlerts(results);
    } catch (err) {
      errorLog("fleet-alert", "Poll loop error", err);
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
      pipeline: { name: string } | null;
    },
  ): Promise<FiredFleetAlertEvent | null> {
    if (!rule.condition || rule.threshold == null) return null;

    // Compute the metric value
    const metricResult = await this.readFleetMetric(
      rule.metric as (typeof FLEET_METRICS extends Set<infer T> ? T : never),
      rule.environmentId,
      rule.pipelineId,
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
          // For throughput drops, fetch per-pipeline breakdown for a richer message.
          // Failure here must not block alert creation — fall back to base message.
          let throughputDetail: ThroughputDropDetail | undefined;
          if (rule.metric === "fleet_throughput_drop") {
            try {
              const detail = await getFleetThroughputDropDetail(rule.environmentId);
              if (detail) throughputDetail = detail;
            } catch (detailErr) {
              errorLog("fleet-alert", "Throughput detail enrichment failed, using base message", detailErr);
            }
          }

          const message = this.buildMessage(rule, value, throughputDetail);
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

          return { event, rule, nodeHost, throughputDetail };
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
    pipelineId: string | null,
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
      case "latency_mean":
        if (!pipelineId) return null;
        return getPipelineLatencyMean(pipelineId);
      case "throughput_floor":
        if (!pipelineId) return null;
        return getPipelineThroughputFloor(pipelineId);
      default:
        return null;
    }
  }

  /**
   * Build a human-readable message for a fleet alert event.
   */
  private buildMessage(rule: AlertRule, value: number, throughputDetail?: ThroughputDropDetail): string {
    const METRIC_LABELS: Record<string, string> = {
      fleet_error_rate: "Fleet error rate",
      fleet_throughput_drop: "Fleet throughput drop",
      fleet_event_volume: "Fleet event volume",
      node_load_imbalance: "Node load imbalance",
      version_drift: "Version drift",
      latency_mean: "Pipeline mean latency",
      throughput_floor: "Pipeline throughput floor",
    };

    const CONDITION_LABELS: Record<string, string> = {
      gt: ">",
      lt: "<",
      eq: "=",
    };

    const metricLabel = METRIC_LABELS[rule.metric] ?? rule.metric;
    const condLabel = CONDITION_LABELS[rule.condition ?? ""] ?? rule.condition;

    let msg = `${metricLabel} at ${value.toFixed(2)} (threshold: ${condLabel} ${rule.threshold})`;

    if (throughputDetail && throughputDetail.breakdown.length > 0) {
      const parts = throughputDetail.breakdown.map(
        (b) => `${b.pipelineName} (-${b.dropPercent.toFixed(0)}%)`,
      );
      msg += `. Top drops: ${parts.join(", ")}`;
    }

    return msg;
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
          severity: rule.severity,
          ownerHint: rule.ownerHint,
          suggestedAction: rule.suggestedAction,
          environment: rule.environment.name,
          team: rule.environment.team?.name,
          node: nodeHost,
          pipeline: rule.pipeline?.name,
          metric: rule.metric,
          value: event.value,
          threshold: rule.threshold ?? 0,
          message: event.message ?? "",
          timestamp: event.firedAt.toISOString(),
          dashboardUrl: `${process.env.NEXTAUTH_URL ?? ""}/alerts`,
        };

        // Deliver to notification channels with delivery tracking
        deliverToChannels(
          rule.environmentId,
          rule.id,
          payload,
          event.id,
        ).catch((err) =>
          errorLog("fleet-alert", "Channel delivery error", err),
        );
      } catch (err) {
        errorLog("fleet-alert", `Delivery error for event ${event.id}`, err);
      }
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const fleetAlertService = new FleetAlertService();

export function initFleetAlertService(): void {
  fleetAlertService.init();
}
