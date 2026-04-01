import { prisma } from "@/lib/prisma";
import type {
  AlertMetric,
  AlertCondition,
  AlertRule,
  AlertEvent,
} from "@/generated/prisma";
import { Prisma } from "@/generated/prisma";
import { queryErrorContext } from "@/server/services/error-context";
import { getConfigDrift } from "@/server/services/drift-metrics";
import { shouldSuppressDuplicate } from "@/server/services/alert-deduplication";
import { correlateEvent, suggestRootCause, closeResolvedGroups } from "@/server/services/alert-correlator";

// ---------------------------------------------------------------------------
// Fleet-scoped metrics — handled by FleetAlertService, not per-node heartbeat.
// ---------------------------------------------------------------------------

export const FLEET_METRICS = new Set<AlertMetric>([
  "fleet_error_rate",
  "fleet_throughput_drop",
  "fleet_event_volume",
  "node_load_imbalance",
  "version_drift",
  "cost_threshold_exceeded",
]);

// ---------------------------------------------------------------------------
// In-memory map tracking when a rule condition was first observed as true.
// Keyed by "alertRuleId:nodeId" → firstSeenAt timestamp.
// ---------------------------------------------------------------------------
const conditionFirstSeen = new Map<string, Date>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compare a numeric value against a threshold using the given condition. */
export function checkCondition(
  value: number,
  condition: AlertCondition,
  threshold: number,
): boolean {
  switch (condition) {
    case "gt":
      return value > threshold;
    case "lt":
      return value < threshold;
    case "eq":
      // Intentional strict equality — only meaningful for binary (0/1) metrics
      // like node_unreachable and pipeline_crashed. Exact float equality is
      // effectively unreachable for percentage-based metrics.
      return value === threshold;
    default:
      return false;
  }
}

/** Derive CPU usage percentage from the two most recent NodeMetric rows. */
async function getCpuUsage(nodeId: string): Promise<number | null> {
  const rows = await prisma.nodeMetric.findMany({
    where: { nodeId },
    orderBy: { timestamp: "desc" },
    take: 2,
    select: { cpuSecondsTotal: true, cpuSecondsIdle: true },
  });

  if (rows.length < 2) return null;

  const [newer, older] = rows;
  const totalDelta = newer.cpuSecondsTotal - older.cpuSecondsTotal;
  if (totalDelta <= 0) return null; // counter reset or no change

  const idleDelta = newer.cpuSecondsIdle - older.cpuSecondsIdle;
  return Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100));
}

/** Compute memory usage percentage from the latest NodeMetric row. */
async function getMemoryUsage(nodeId: string): Promise<number | null> {
  const row = await prisma.nodeMetric.findFirst({
    where: { nodeId },
    orderBy: { timestamp: "desc" },
    select: { memoryUsedBytes: true, memoryTotalBytes: true },
  });

  if (!row) return null;
  const total = Number(row.memoryTotalBytes);
  if (total <= 0) return null;

  return (Number(row.memoryUsedBytes) / total) * 100;
}

/** Compute disk usage percentage from the latest NodeMetric row. */
async function getDiskUsage(nodeId: string): Promise<number | null> {
  const row = await prisma.nodeMetric.findFirst({
    where: { nodeId },
    orderBy: { timestamp: "desc" },
    select: { fsUsedBytes: true, fsTotalBytes: true },
  });

  if (!row) return null;
  const total = Number(row.fsTotalBytes);
  if (total <= 0) return null;

  return (Number(row.fsUsedBytes) / total) * 100;
}

/**
 * Compute an error rate for pipelines running on a given node.
 * If a specific pipelineId is provided on the rule, scope to that pipeline.
 * Returns errorsTotal / eventsIn * 100 (percentage) for the latest minute bucket.
 */
async function getErrorRate(
  nodeId: string,
  pipelineId: string | null,
): Promise<number | null> {
  const where: Record<string, unknown> = { nodeId };
  if (pipelineId) where.pipelineId = pipelineId;

  const rows = await prisma.nodePipelineStatus.findMany({
    where,
    select: { eventsIn: true, errorsTotal: true },
  });

  if (rows.length === 0) return null;

  let totalIn = BigInt(0);
  let totalErr = BigInt(0);
  for (const r of rows) {
    totalIn += r.eventsIn;
    totalErr += r.errorsTotal;
  }

  if (totalIn === BigInt(0)) return 0;
  return (Number(totalErr) / Number(totalIn)) * 100;
}

/**
 * Compute a discarded event rate for pipelines running on a given node.
 * Returns eventsDiscarded / eventsIn * 100 (percentage).
 */
async function getDiscardedRate(
  nodeId: string,
  pipelineId: string | null,
): Promise<number | null> {
  const where: Record<string, unknown> = { nodeId };
  if (pipelineId) where.pipelineId = pipelineId;

  const rows = await prisma.nodePipelineStatus.findMany({
    where,
    select: { eventsIn: true, eventsDiscarded: true },
  });

  if (rows.length === 0) return null;

  let totalIn = BigInt(0);
  let totalDiscarded = BigInt(0);
  for (const r of rows) {
    totalIn += r.eventsIn;
    totalDiscarded += r.eventsDiscarded;
  }

  if (totalIn === BigInt(0)) return 0;
  return (Number(totalDiscarded) / Number(totalIn)) * 100;
}

/**
 * Check whether any pipeline on this node (or a specific pipeline) has crashed.
 * Returns 1 if at least one is CRASHED, 0 otherwise.
 */
async function getPipelineCrashed(
  nodeId: string,
  pipelineId: string | null,
): Promise<number> {
  const where: Record<string, unknown> = { nodeId, status: "CRASHED" };
  if (pipelineId) where.pipelineId = pipelineId;

  const count = await prisma.nodePipelineStatus.count({ where });
  return count > 0 ? 1 : 0;
}

/**
 * Read the current metric value for a given AlertMetric on a particular node.
 * Returns null if the metric cannot be determined (e.g. no data yet).
 */
async function readMetricValue(
  metric: AlertMetric,
  nodeId: string,
  nodeStatus: string,
  pipelineId: string | null,
): Promise<number | null> {
  switch (metric) {
    case "node_unreachable":
      // Binary: 1 = unreachable, 0 = reachable
      return nodeStatus === "UNREACHABLE" ? 1 : 0;

    case "cpu_usage":
      return getCpuUsage(nodeId);

    case "memory_usage":
      return getMemoryUsage(nodeId);

    case "disk_usage":
      return getDiskUsage(nodeId);

    case "error_rate":
      return getErrorRate(nodeId, pipelineId);

    case "discarded_rate":
      return getDiscardedRate(nodeId, pipelineId);

    case "pipeline_crashed":
      return getPipelineCrashed(nodeId, pipelineId);

    case "config_drift": {
      const drift = await getConfigDrift(nodeId, pipelineId);
      if (drift === null) return null;
      return drift.value;
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FiredAlertEvent {
  event: AlertEvent;
  rule: AlertRule;
}

/**
 * Evaluate all enabled alert rules for the given environment against the
 * current state of a specific node.  Called during heartbeat processing.
 *
 * Returns an array of alert events that were just created or resolved and
 * need webhook notification.
 */
export async function evaluateAlerts(
  nodeId: string,
  environmentId: string,
): Promise<FiredAlertEvent[]> {
  // Load the node to get its current status
  const node = await prisma.vectorNode.findUnique({
    where: { id: nodeId },
    select: { status: true },
  });

  if (!node) return [];

  // Load all enabled, non-snoozed rules for this environment
  const rules = await prisma.alertRule.findMany({
    where: {
      environmentId,
      enabled: true,
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
      pipeline: { select: { name: true } },
    },
  });

  const results: FiredAlertEvent[] = [];

  for (const rule of rules) {
    // Skip event-based rules — they fire inline, not via polling
    if (!rule.condition || rule.threshold == null) continue;

    // Skip fleet-scoped metrics — handled by FleetAlertService
    if (FLEET_METRICS.has(rule.metric)) continue;

    const value = await readMetricValue(
      rule.metric,
      nodeId,
      node.status,
      rule.pipelineId,
    );

    // If we can't read the metric, skip evaluation for this rule
    if (value === null) {
      // Clear duration tracking since we have no data
      conditionFirstSeen.delete(`${rule.id}:${nodeId}`);
      continue;
    }

    const conditionMet = checkCondition(value, rule.condition, rule.threshold);
    const now = new Date();

    if (conditionMet) {
      // Track when the condition was first seen
      const durationKey = `${rule.id}:${nodeId}`;
      if (!conditionFirstSeen.has(durationKey)) {
        conditionFirstSeen.set(durationKey, now);
      }

      const firstSeen = conditionFirstSeen.get(durationKey)!;
      const elapsedSeconds = (now.getTime() - firstSeen.getTime()) / 1000;

      // Only fire if the condition has persisted for the required duration
      if (elapsedSeconds >= (rule.durationSeconds ?? 0)) {
        // Check if there is already an open (firing or acknowledged) event for this rule
        const existingEvent = await prisma.alertEvent.findFirst({
          where: {
            alertRuleId: rule.id,
            status: { in: ["firing", "acknowledged"] },
            resolvedAt: null,
          },
          orderBy: { firedAt: "desc" },
        });

        if (!existingEvent) {
          // ── Deduplication: skip if recently resolved within cooldown ──
          const suppressed = await shouldSuppressDuplicate(rule, nodeId, now);
          if (suppressed) continue;

          // Create a new firing event
          const message = buildMessage(rule, value, rule.pipeline?.name);
          const event = await prisma.alertEvent.create({
            data: {
              alertRuleId: rule.id,
              nodeId,
              status: "firing",
              value,
              message,
            },
          });

          // Attach error context for error-related alerts
          if (rule.metric === "error_rate" && rule.pipelineId) {
            const errorContext = await queryErrorContext(rule.pipelineId);
            if (errorContext) {
              await prisma.alertEvent.update({
                where: { id: event.id },
                data: { errorContext: errorContext as unknown as Prisma.InputJsonValue },
              });
            }
          }

          // ── Correlation: assign to a group ──
          const group = await correlateEvent(event, rule);
          if (group.eventCount > 1) {
            await suggestRootCause(group.id);
          }

          results.push({ event, rule });
        }
      }
    } else {
      // Condition no longer met — clear duration tracking
      conditionFirstSeen.delete(`${rule.id}:${nodeId}`);

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

        // ── Close correlation groups with no remaining active events ──
        await closeResolvedGroups(environmentId);

        results.push({ event: resolved, rule });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const METRIC_LABELS: Record<AlertMetric, string> = {
  node_unreachable: "Node unreachable",
  cpu_usage: "CPU usage",
  memory_usage: "Memory usage",
  disk_usage: "Disk usage",
  error_rate: "Error rate",
  discarded_rate: "Discarded event rate",
  pipeline_crashed: "Pipeline crashed",
  fleet_error_rate: "Fleet error rate",
  fleet_throughput_drop: "Fleet throughput drop",
  fleet_event_volume: "Fleet event volume",
  node_load_imbalance: "Node load imbalance",
  version_drift: "Version drift",
  config_drift: "Config drift",
  deploy_requested: "Deploy requested",
  deploy_completed: "Deploy completed",
  deploy_rejected: "Deploy rejected",
  deploy_cancelled: "Deploy cancelled",
  new_version_available: "New version available",
  scim_sync_failed: "SCIM sync failed",
  backup_failed: "Backup failed",
  certificate_expiring: "Certificate expiring",
  node_joined: "Node joined",
  node_left: "Node left",
  promotion_completed: "Promotion completed",
  git_sync_failed: "Git sync failed",
  cost_threshold_exceeded: "Cost threshold exceeded",
  log_keyword: "Log keyword match",
};

const CONDITION_LABELS: Record<AlertCondition, string> = {
  gt: ">",
  lt: "<",
  eq: "=",
};

/** Metrics where the value is binary (0/1) and the numeric details are noise. */
const BINARY_METRICS = new Set<AlertMetric>([
  "pipeline_crashed",
  "node_unreachable",
]);

function buildMessage(
  rule: AlertRule,
  value: number,
  pipelineName?: string | null,
): string {
  const metricLabel = METRIC_LABELS[rule.metric] ?? rule.metric;

  if (!rule.condition || rule.threshold == null) {
    return pipelineName
      ? `${metricLabel}: ${pipelineName}`
      : `${metricLabel}`;
  }

  // Binary metrics: just state what happened, with the pipeline name if available
  if (BINARY_METRICS.has(rule.metric)) {
    return pipelineName
      ? `${metricLabel}: ${pipelineName}`
      : `${metricLabel}`;
  }

  // Numeric metrics: include value and threshold for context
  const condLabel = CONDITION_LABELS[rule.condition] ?? rule.condition;
  const prefix = pipelineName ? `${pipelineName} — ` : "";
  return `${prefix}${metricLabel} at ${value.toFixed(2)} (threshold: ${condLabel} ${rule.threshold})`;
}

// ---------------------------------------------------------------------------
// Batch evaluation — pre-fetch all metrics, evaluate all rules against cache
// ---------------------------------------------------------------------------

/** In-memory cache of metric values for an entire environment. */
export interface MetricCache {
  /** nodeId → node status string */
  nodeStatuses: Map<string, string>;
  /** Ordered list of node IDs in this environment */
  nodeIds: string[];
  /**
   * nodeId → { cpuUsage, memoryUsage, diskUsage }
   * Derived from the 2 most recent NodeMetric rows per node.
   */
  nodeMetrics: Map<
    string,
    { cpuUsage: number | null; memoryUsage: number | null; diskUsage: number | null }
  >;
  /**
   * "nodeId:pipelineId" → { errorRate, discardedRate, crashed }
   * Derived from NodePipelineStatus rows.
   */
  pipelineMetrics: Map<
    string,
    { errorRate: number; discardedRate: number; crashed: boolean }
  >;
  /**
   * nodeId → aggregated { errorRate, discardedRate, crashed }
   * Aggregated across all pipelines on a node.
   */
  nodeAggPipelineMetrics: Map<
    string,
    { errorRate: number; discardedRate: number; crashed: boolean }
  >;
}

/**
 * Pre-fetch all metrics for an environment in 3 bulk queries.
 * Returns an in-memory cache that `evaluateAlertsBatch` uses.
 */
export async function buildMetricCache(
  environmentId: string,
): Promise<MetricCache> {
  // 1. Get all nodes in this environment
  const nodes = await prisma.vectorNode.findMany({
    where: { environmentId },
    select: { id: true, status: true },
  });

  const nodeIds = nodes.map((n) => n.id);
  const nodeStatuses = new Map(nodes.map((n) => [n.id, n.status]));

  if (nodeIds.length === 0) {
    return {
      nodeStatuses,
      nodeIds,
      nodeMetrics: new Map(),
      pipelineMetrics: new Map(),
      nodeAggPipelineMetrics: new Map(),
    };
  }

  // 2. Bulk fetch the 2 most recent NodeMetric rows per node
  //    We fetch last N*2 rows ordered by nodeId+timestamp desc, then
  //    take the first 2 per node in JS (Prisma doesn't support per-group LIMIT).
  const recentNodeMetrics = await prisma.nodeMetric.findMany({
    where: { nodeId: { in: nodeIds } },
    orderBy: [{ nodeId: "asc" }, { timestamp: "desc" }],
    take: nodeIds.length * 2,
    select: {
      nodeId: true,
      timestamp: true,
      cpuSecondsTotal: true,
      cpuSecondsIdle: true,
      memoryUsedBytes: true,
      memoryTotalBytes: true,
      fsUsedBytes: true,
      fsTotalBytes: true,
    },
  });

  // 3. Bulk fetch all NodePipelineStatus rows for these nodes
  const allPipelineStatuses = await prisma.nodePipelineStatus.findMany({
    where: { nodeId: { in: nodeIds } },
    select: {
      nodeId: true,
      pipelineId: true,
      status: true,
      eventsIn: true,
      errorsTotal: true,
      eventsDiscarded: true,
    },
  });

  // Build node metrics cache (CPU, memory, disk per node)
  const nodeMetricsByNode = new Map<string, typeof recentNodeMetrics>();
  for (const row of recentNodeMetrics) {
    const existing = nodeMetricsByNode.get(row.nodeId) ?? [];
    if (existing.length < 2) {
      existing.push(row);
      nodeMetricsByNode.set(row.nodeId, existing);
    }
  }

  const nodeMetrics = new Map<
    string,
    { cpuUsage: number | null; memoryUsage: number | null; diskUsage: number | null }
  >();

  for (const [nodeId, rows] of nodeMetricsByNode) {
    let cpuUsage: number | null = null;
    let memoryUsage: number | null = null;
    let diskUsage: number | null = null;

    if (rows.length >= 2) {
      const [newer, older] = rows;
      const totalDelta = newer.cpuSecondsTotal - older.cpuSecondsTotal;
      if (totalDelta > 0) {
        const idleDelta = newer.cpuSecondsIdle - older.cpuSecondsIdle;
        cpuUsage = Math.max(
          0,
          Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100),
        );
      }
    }

    if (rows.length >= 1) {
      const latest = rows[0];
      const memTotal = Number(latest.memoryTotalBytes);
      if (memTotal > 0) {
        memoryUsage = (Number(latest.memoryUsedBytes) / memTotal) * 100;
      }
      const fsTotal = Number(latest.fsTotalBytes);
      if (fsTotal > 0) {
        diskUsage = (Number(latest.fsUsedBytes) / fsTotal) * 100;
      }
    }

    nodeMetrics.set(nodeId, { cpuUsage, memoryUsage, diskUsage });
  }

  // Build pipeline metrics cache
  const pipelineMetrics = new Map<
    string,
    { errorRate: number; discardedRate: number; crashed: boolean }
  >();

  // Also build per-node aggregates
  const nodeAggData = new Map<
    string,
    { totalIn: bigint; totalErr: bigint; totalDiscarded: bigint; anyCrashed: boolean }
  >();

  for (const ps of allPipelineStatuses) {
    const key = `${ps.nodeId}:${ps.pipelineId}`;
    const evIn = ps.eventsIn;
    const evErr = ps.errorsTotal;
    const evDisc = ps.eventsDiscarded;

    const errorRate = evIn === BigInt(0) ? 0 : (Number(evErr) / Number(evIn)) * 100;
    const discardedRate = evIn === BigInt(0) ? 0 : (Number(evDisc) / Number(evIn)) * 100;
    const crashed = ps.status === "CRASHED";

    pipelineMetrics.set(key, { errorRate, discardedRate, crashed });

    // Aggregate per node
    const agg = nodeAggData.get(ps.nodeId) ?? {
      totalIn: BigInt(0),
      totalErr: BigInt(0),
      totalDiscarded: BigInt(0),
      anyCrashed: false,
    };
    agg.totalIn += evIn;
    agg.totalErr += evErr;
    agg.totalDiscarded += evDisc;
    if (crashed) agg.anyCrashed = true;
    nodeAggData.set(ps.nodeId, agg);
  }

  const nodeAggPipelineMetrics = new Map<
    string,
    { errorRate: number; discardedRate: number; crashed: boolean }
  >();

  for (const [nodeId, agg] of nodeAggData) {
    const errorRate =
      agg.totalIn === BigInt(0)
        ? 0
        : (Number(agg.totalErr) / Number(agg.totalIn)) * 100;
    const discardedRate =
      agg.totalIn === BigInt(0)
        ? 0
        : (Number(agg.totalDiscarded) / Number(agg.totalIn)) * 100;
    nodeAggPipelineMetrics.set(nodeId, {
      errorRate,
      discardedRate,
      crashed: agg.anyCrashed,
    });
  }

  return {
    nodeStatuses,
    nodeIds,
    nodeMetrics,
    pipelineMetrics,
    nodeAggPipelineMetrics,
  };
}

/**
 * Read a metric value from the pre-built cache (no database queries).
 * Returns null if the metric cannot be determined from cached data.
 */
function readMetricFromCache(
  metric: AlertMetric,
  nodeId: string,
  cache: MetricCache,
  pipelineId: string | null,
): number | null {
  switch (metric) {
    case "node_unreachable": {
      const status = cache.nodeStatuses.get(nodeId);
      return status === "UNREACHABLE" ? 1 : 0;
    }

    case "cpu_usage":
      return cache.nodeMetrics.get(nodeId)?.cpuUsage ?? null;

    case "memory_usage":
      return cache.nodeMetrics.get(nodeId)?.memoryUsage ?? null;

    case "disk_usage":
      return cache.nodeMetrics.get(nodeId)?.diskUsage ?? null;

    case "error_rate": {
      if (pipelineId) {
        const key = `${nodeId}:${pipelineId}`;
        return cache.pipelineMetrics.get(key)?.errorRate ?? null;
      }
      return cache.nodeAggPipelineMetrics.get(nodeId)?.errorRate ?? null;
    }

    case "discarded_rate": {
      if (pipelineId) {
        const key = `${nodeId}:${pipelineId}`;
        return cache.pipelineMetrics.get(key)?.discardedRate ?? null;
      }
      return cache.nodeAggPipelineMetrics.get(nodeId)?.discardedRate ?? null;
    }

    case "pipeline_crashed": {
      if (pipelineId) {
        const key = `${nodeId}:${pipelineId}`;
        return cache.pipelineMetrics.get(key)?.crashed ? 1 : 0;
      }
      return cache.nodeAggPipelineMetrics.get(nodeId)?.crashed ? 1 : 0;
    }

    // config_drift requires a per-node query that cannot be efficiently
    // batch-cached (it compares YAML checksums). We return null here;
    // the caller should fall back to per-rule evaluation for drift rules.
    case "config_drift":
      return null;

    default:
      return null;
  }
}

/**
 * Evaluate all enabled alert rules for an entire environment in batch.
 *
 * Unlike `evaluateAlerts()` (called per-node during heartbeat), this function
 * pre-fetches all metrics in 3 bulk queries, builds an in-memory cache, then
 * evaluates every rule against every node using the cache.
 *
 * Intended to run as a background job every 60s.
 *
 * Returns all alert events that were created or resolved.
 */
export async function evaluateAlertsBatch(
  environmentId: string,
): Promise<FiredAlertEvent[]> {
  // 1. Build the metric cache (3 bulk queries)
  const cache = await buildMetricCache(environmentId);

  if (cache.nodeIds.length === 0) return [];

  // 2. Load all enabled, non-snoozed rules for this environment
  const rules = await prisma.alertRule.findMany({
    where: {
      environmentId,
      enabled: true,
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
      pipeline: { select: { name: true } },
    },
  });

  const results: FiredAlertEvent[] = [];

  // 3. Evaluate each rule against each node using cached data
  for (const rule of rules) {
    // Skip event-based rules
    if (!rule.condition || rule.threshold == null) continue;

    // Skip fleet-scoped metrics
    if (FLEET_METRICS.has(rule.metric)) continue;

    for (const nodeId of cache.nodeIds) {
      const value = readMetricFromCache(
        rule.metric,
        nodeId,
        cache,
        rule.pipelineId,
      );

      // If we can't read the metric from cache (e.g., config_drift),
      // fall back to the per-rule query approach
      if (value === null) {
        const nodeStatus = cache.nodeStatuses.get(nodeId) ?? "UNKNOWN";
        const fallbackValue = await readMetricValue(
          rule.metric,
          nodeId,
          nodeStatus,
          rule.pipelineId,
        );
        if (fallbackValue === null) {
          conditionFirstSeen.delete(`${rule.id}:${nodeId}`);
          continue;
        }
        // Process the fallback value (same logic as below)
        const fallbackResults = await processRuleForNode(
          rule,
          nodeId,
          fallbackValue,
        );
        results.push(...fallbackResults);
        continue;
      }

      const ruleResults = await processRuleForNode(rule, nodeId, value);
      results.push(...ruleResults);
    }
  }

  return results;
}

/**
 * Process a single rule evaluation for a single node.
 * Extracted to avoid duplication between cached and fallback paths.
 */
async function processRuleForNode(
  rule: AlertRule & { pipeline: { name: string } | null },
  nodeId: string,
  value: number,
): Promise<FiredAlertEvent[]> {
  const results: FiredAlertEvent[] = [];
  const conditionMet = checkCondition(value, rule.condition!, rule.threshold!);
  const now = new Date();

  if (conditionMet) {
    const durationKey = `${rule.id}:${nodeId}`;
    if (!conditionFirstSeen.has(durationKey)) {
      conditionFirstSeen.set(durationKey, now);
    }

    const firstSeen = conditionFirstSeen.get(durationKey)!;
    const elapsedSeconds = (now.getTime() - firstSeen.getTime()) / 1000;

    if (elapsedSeconds >= (rule.durationSeconds ?? 0)) {
      const existingEvent = await prisma.alertEvent.findFirst({
        where: {
          alertRuleId: rule.id,
          nodeId,
          status: { in: ["firing", "acknowledged"] },
          resolvedAt: null,
        },
        orderBy: { firedAt: "desc" },
      });

      if (!existingEvent) {
        const message = buildMessage(rule, value, rule.pipeline?.name);
        const event = await prisma.alertEvent.create({
          data: {
            alertRuleId: rule.id,
            nodeId,
            status: "firing",
            value,
            message,
          },
        });

        // Attach error context for error-related alerts
        if (rule.metric === "error_rate" && rule.pipelineId) {
          const errorContext = await queryErrorContext(rule.pipelineId);
          if (errorContext) {
            await prisma.alertEvent.update({
              where: { id: event.id },
              data: { errorContext: errorContext as unknown as Prisma.InputJsonValue },
            });
          }
        }

        results.push({ event, rule });
      }
    }
  } else {
    conditionFirstSeen.delete(`${rule.id}:${nodeId}`);

    const openEvent = await prisma.alertEvent.findFirst({
      where: {
        alertRuleId: rule.id,
        nodeId,
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
      results.push({ event: resolved, rule });
    }
  }

  return results;
}
