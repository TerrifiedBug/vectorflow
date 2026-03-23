import { prisma } from "@/lib/prisma";

export interface MetricsDataPoint {
  nodeId: string;
  pipelineId: string;
  eventsIn: bigint;
  eventsOut: bigint;
  errorsTotal: bigint;
  eventsDiscarded: bigint;
  bytesIn: bigint;
  bytesOut: bigint;
  utilization: number;
  latencyMeanMs: number | null;
}

export interface PreviousSnapshot {
  eventsIn: bigint;
  eventsOut: bigint;
  errorsTotal: bigint;
  eventsDiscarded: bigint;
  bytesIn: bigint;
  bytesOut: bigint;
}

/**
 * Clamp a delta to zero when the counter has reset (current < previous).
 * Returns BigInt(0) when previous is null (first sample — no delta yet).
 */
export function clamp(curr: bigint, prevVal: bigint | null | undefined): bigint {
  if (prevVal == null) return BigInt(0);
  const diff = curr - prevVal;
  return diff < BigInt(0) ? BigInt(0) : diff;
}

/** Shape of a per-node metric row to insert. */
interface PerNodeRow {
  pipelineId: string;
  nodeId: string;
  timestamp: Date;
  eventsIn: bigint;
  eventsOut: bigint;
  errorsTotal: bigint;
  eventsDiscarded: bigint;
  bytesIn: bigint;
  bytesOut: bigint;
  utilization: number;
  latencyMeanMs?: number | null;
}

/**
 * Compute per-node delta rows from heartbeat data points and their previous snapshots.
 * Pure function — no DB access.
 */
export function computeDeltas(
  dataPoints: MetricsDataPoint[],
  previousSnapshots: Map<string, PreviousSnapshot> | undefined,
  now: Date,
): PerNodeRow[] {
  const rows: PerNodeRow[] = [];

  for (const dp of dataPoints) {
    const snapshotKey = `${dp.nodeId}:${dp.pipelineId}`;
    const prev = previousSnapshots?.get(snapshotKey);

    rows.push({
      pipelineId: dp.pipelineId,
      nodeId: dp.nodeId,
      timestamp: now,
      eventsIn: clamp(dp.eventsIn, prev?.eventsIn),
      eventsOut: clamp(dp.eventsOut, prev?.eventsOut),
      errorsTotal: clamp(dp.errorsTotal, prev?.errorsTotal),
      eventsDiscarded: clamp(dp.eventsDiscarded, prev?.eventsDiscarded),
      bytesIn: clamp(dp.bytesIn, prev?.bytesIn),
      bytesOut: clamp(dp.bytesOut, prev?.bytesOut),
      utilization: dp.utilization,
      ...(dp.latencyMeanMs != null ? { latencyMeanMs: dp.latencyMeanMs } : {}),
    });
  }

  return rows;
}

/** Shape of an aggregation row (nodeId: null, componentId: null). */
interface AggregationRow {
  pipelineId: string;
  timestamp: Date;
  eventsIn: bigint;
  eventsOut: bigint;
  errorsTotal: bigint;
  eventsDiscarded: bigint;
  bytesIn: bigint;
  bytesOut: bigint;
  utilization: number;
  latencyMeanMs?: number | null;
}

/**
 * Compute a single aggregation row from an array of per-node rows for one pipeline.
 * Sums counter fields, averages utilization, and computes weighted-average latency.
 * Pure function — no DB access.
 */
export function computeAggregation(
  pipelineId: string,
  nodeRows: Array<{
    eventsIn: bigint;
    eventsOut: bigint;
    errorsTotal: bigint;
    eventsDiscarded: bigint;
    bytesIn: bigint;
    bytesOut: bigint;
    utilization: number;
    latencyMeanMs?: number | null;
  }>,
  timestamp: Date,
): AggregationRow {
  let totalEventsIn = BigInt(0);
  let totalEventsOut = BigInt(0);
  let totalErrors = BigInt(0);
  let totalDiscarded = BigInt(0);
  let totalBytesIn = BigInt(0);
  let totalBytesOut = BigInt(0);
  let totalUtil = 0;
  let latencyWeightedSum = 0;
  let latencyWeightCount = 0;

  for (const row of nodeRows) {
    totalEventsIn += row.eventsIn;
    totalEventsOut += row.eventsOut;
    totalErrors += row.errorsTotal;
    totalDiscarded += row.eventsDiscarded;
    totalBytesIn += row.bytesIn;
    totalBytesOut += row.bytesOut;
    totalUtil += row.utilization;
    if (row.latencyMeanMs != null) {
      const rowEvents = Number(row.eventsIn) + Number(row.eventsOut);
      latencyWeightedSum += row.latencyMeanMs * rowEvents;
      latencyWeightCount += rowEvents;
    }
  }

  const avgUtil = nodeRows.length > 0 ? totalUtil / nodeRows.length : 0;
  const avgLatencyMs =
    latencyWeightCount > 0 ? latencyWeightedSum / latencyWeightCount : null;

  return {
    pipelineId,
    timestamp,
    eventsIn: totalEventsIn,
    eventsOut: totalEventsOut,
    errorsTotal: totalErrors,
    eventsDiscarded: totalDiscarded,
    bytesIn: totalBytesIn,
    bytesOut: totalBytesOut,
    utilization: avgUtil,
    ...(avgLatencyMs != null ? { latencyMeanMs: avgLatencyMs } : {}),
  };
}

/**
 * Ingest metrics from agent heartbeats by computing rate diffs from cumulative counters.
 *
 * Strategy (batch — no per-pipeline query loop):
 * 1. Compute all deltas in-memory from previousSnapshots.
 * 2. Inside a $transaction:
 *    a. Delete existing per-node minute rows for this node+timestamp.
 *    b. Insert all new per-node rows with createMany.
 *    c. For each touched pipeline, read all per-node rows (including other nodes),
 *       compute aggregation in-memory.
 *    d. Delete existing aggregation rows for touched pipelines.
 *    e. Insert new aggregation rows with createMany.
 */
export async function ingestMetrics(
  dataPoints: MetricsDataPoint[],
  previousSnapshots?: Map<string, PreviousSnapshot>,
): Promise<void> {
  if (dataPoints.length === 0) return;

  // Round timestamp to current minute
  const now = new Date();
  now.setSeconds(0, 0);

  // 1. Compute all deltas in-memory
  const perNodeRows = computeDeltas(dataPoints, previousSnapshots, now);

  // Track which pipelines we touched for aggregation
  const touchedPipelineIds = [...new Set(dataPoints.map((dp) => dp.pipelineId))];

  const nodeId = dataPoints[0].nodeId;

  // 2. Execute batch writes inside a transaction
  await prisma.$transaction(async (tx) => {
    // 2a. Delete existing per-node minute rows for this node
    await tx.pipelineMetric.deleteMany({
      where: {
        nodeId,
        componentId: null,
        timestamp: now,
      },
    });

    // 2b. Insert all new per-node rows
    await tx.pipelineMetric.createMany({ data: perNodeRows });

    // 2c. For each touched pipeline, gather all per-node rows and compute aggregation
    const aggregationRows: AggregationRow[] = [];

    for (const pipelineId of touchedPipelineIds) {
      const allNodeRows = await tx.pipelineMetric.findMany({
        where: {
          pipelineId,
          nodeId: { not: null },
          componentId: null,
          timestamp: now,
        },
      });

      aggregationRows.push(computeAggregation(pipelineId, allNodeRows, now));
    }

    // 2d. Delete existing aggregation rows for touched pipelines
    if (touchedPipelineIds.length > 0) {
      await tx.pipelineMetric.deleteMany({
        where: {
          pipelineId: { in: touchedPipelineIds },
          nodeId: null,
          componentId: null,
          timestamp: now,
        },
      });
    }

    // 2e. Insert new aggregation rows
    if (aggregationRows.length > 0) {
      await tx.pipelineMetric.createMany({ data: aggregationRows });
    }
  });
}
