import { prisma } from "@/lib/prisma";
import type {
  AlertMetric,
  AlertCondition,
  AlertRule,
  AlertEvent,
} from "@/generated/prisma";

// ---------------------------------------------------------------------------
// In-memory map tracking when a rule condition was first observed as true.
// Keyed by "alertRuleId:nodeId" → firstSeenAt timestamp.
// ---------------------------------------------------------------------------
const conditionFirstSeen = new Map<string, Date>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compare a numeric value against a threshold using the given condition. */
function checkCondition(
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
    select: { cpuSecondsTotal: true, timestamp: true },
  });

  if (rows.length < 2) return null;

  const [newer, older] = rows;
  const dtSeconds =
    (newer.timestamp.getTime() - older.timestamp.getTime()) / 1000;
  if (dtSeconds <= 0) return null;

  // cpuSecondsTotal is cumulative; the delta / wall-clock-delta gives
  // fraction of one core used. Multiply by 100 for a percentage.
  const cpuDelta = newer.cpuSecondsTotal - older.cpuSecondsTotal;
  if (cpuDelta < 0) return null; // counter reset

  return (cpuDelta / dtSeconds) * 100;
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

  // Load all enabled rules for this environment
  const rules = await prisma.alertRule.findMany({
    where: {
      environmentId,
      enabled: true,
    },
  });

  const results: FiredAlertEvent[] = [];

  for (const rule of rules) {
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
      if (elapsedSeconds >= rule.durationSeconds) {
        // Check if there is already an open (firing) event for this rule
        const existingEvent = await prisma.alertEvent.findFirst({
          where: {
            alertRuleId: rule.id,
            status: "firing",
            resolvedAt: null,
          },
          orderBy: { firedAt: "desc" },
        });

        if (!existingEvent) {
          // Create a new firing event
          const message = buildMessage(rule, value);
          const event = await prisma.alertEvent.create({
            data: {
              alertRuleId: rule.id,
              status: "firing",
              value,
              message,
            },
          });
          results.push({ event, rule });
        }
      }
    } else {
      // Condition no longer met — clear duration tracking
      conditionFirstSeen.delete(`${rule.id}:${nodeId}`);

      // Resolve any open firing event
      const openEvent = await prisma.alertEvent.findFirst({
        where: {
          alertRuleId: rule.id,
          status: "firing",
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
};

const CONDITION_LABELS: Record<AlertCondition, string> = {
  gt: ">",
  lt: "<",
  eq: "=",
};

function buildMessage(rule: AlertRule, value: number): string {
  const metricLabel = METRIC_LABELS[rule.metric] ?? rule.metric;
  const condLabel = CONDITION_LABELS[rule.condition] ?? rule.condition;
  return `${metricLabel} is ${value.toFixed(2)} (threshold: ${condLabel} ${rule.threshold})`;
}
