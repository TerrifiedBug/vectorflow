import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Fleet-wide metric computation functions.
// Each function takes an environmentId and returns a numeric value (or null
// when there is insufficient data to compute the metric).
// ---------------------------------------------------------------------------

/**
 * Compute the fleet-wide error rate across all pipelines on all nodes in the
 * environment.
 *
 * Returns `(errorsTotal / eventsIn) * 100` as a percentage.
 * Returns `null` if no NodePipelineStatus rows exist for the environment.
 * Returns `0` if `eventsIn > 0` but `errorsTotal == 0`.
 */
export async function getFleetErrorRate(
  environmentId: string,
): Promise<number | null> {
  const rows = await prisma.nodePipelineStatus.findMany({
    where: {
      node: { environmentId },
    },
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
 * Compute total event volume across all pipelines on all nodes in the
 * environment.
 *
 * Returns the sum of `eventsIn` as a plain number.
 * Returns `null` if no NodePipelineStatus rows exist.
 */
export async function getFleetEventVolume(
  environmentId: string,
): Promise<number | null> {
  const rows = await prisma.nodePipelineStatus.findMany({
    where: {
      node: { environmentId },
    },
    select: { eventsIn: true },
  });

  if (rows.length === 0) return null;

  let total = BigInt(0);
  for (const r of rows) {
    total += r.eventsIn;
  }

  return Number(total);
}

/**
 * Compute the throughput drop percentage by comparing current live counters
 * against the aggregate PipelineMetric rows from 30–60 minutes ago.
 *
 * Drop = `((previous − current) / previous) * 100`.
 * A positive value means throughput decreased; negative means it increased.
 * Returns `null` if no previous-period data exists.
 * Returns `0` if both previous and current are 0.
 */
export async function getFleetThroughputDrop(
  environmentId: string,
): Promise<number | null> {
  // Current total from live pipeline status counters
  const currentRows = await prisma.nodePipelineStatus.findMany({
    where: {
      node: { environmentId },
    },
    select: { eventsIn: true },
  });

  let currentTotal = BigInt(0);
  for (const r of currentRows) {
    currentTotal += r.eventsIn;
  }

  // Previous period: aggregate PipelineMetric rows (nodeId IS NULL AND
  // componentId IS NULL) from 30–60 minutes ago, for pipelines in this
  // environment.
  const now = new Date();
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
  const sixtyMinAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const previousRows = await prisma.pipelineMetric.findMany({
    where: {
      nodeId: null,
      componentId: null,
      timestamp: { gte: sixtyMinAgo, lt: thirtyMinAgo },
      pipeline: { environmentId },
    },
    select: { eventsIn: true },
  });

  if (previousRows.length === 0) return null;

  let previousTotal = BigInt(0);
  for (const r of previousRows) {
    previousTotal += r.eventsIn;
  }

  if (previousTotal === BigInt(0)) {
    // No previous throughput — if current is also 0, report 0% drop;
    // otherwise we can't meaningfully compute a percentage.
    return 0;
  }

  return (
    (Number(previousTotal - currentTotal) / Number(previousTotal)) * 100
  );
}

/**
 * Result from the load imbalance computation that includes which node is
 * most imbalanced.
 */
export interface LoadImbalanceResult {
  value: number;
  nodeId: string;
}

/**
 * Compute the node load imbalance within the environment.
 *
 * Finds the node whose total `eventsIn` deviates the most from the fleet
 * average: `|nodeTotal − average| / average * 100`.
 *
 * Returns `null` if fewer than 2 nodes exist.
 * Returns `{ value: 0, nodeId }` if all nodes have equal throughput.
 */
export async function getNodeLoadImbalance(
  environmentId: string,
): Promise<LoadImbalanceResult | null> {
  const rows = await prisma.nodePipelineStatus.findMany({
    where: {
      node: { environmentId },
    },
    select: { nodeId: true, eventsIn: true },
  });

  if (rows.length === 0) return null;

  // Aggregate per-node totals
  const perNode = new Map<string, bigint>();
  for (const r of rows) {
    const prev = perNode.get(r.nodeId) ?? BigInt(0);
    perNode.set(r.nodeId, prev + r.eventsIn);
  }

  const nodeIds = Array.from(perNode.keys());
  if (nodeIds.length < 2) return null;

  // Fleet average
  let fleetTotal = BigInt(0);
  for (const v of perNode.values()) {
    fleetTotal += v;
  }
  const average = Number(fleetTotal) / nodeIds.length;

  if (average === 0) {
    // All nodes at zero traffic — no meaningful imbalance
    return { value: 0, nodeId: nodeIds[0] };
  }

  // Find the node with the largest absolute deviation from average
  let maxDeviation = 0;
  let mostImbalancedNodeId = nodeIds[0];

  for (const [nodeId, total] of perNode.entries()) {
    const deviation = Math.abs(Number(total) - average) / average * 100;
    if (deviation > maxDeviation) {
      maxDeviation = deviation;
      mostImbalancedNodeId = nodeId;
    }
  }

  return { value: maxDeviation, nodeId: mostImbalancedNodeId };
}
