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
 * Add delta values to an existing row's counters. Returns a new row with
 * accumulated totals. Utilization and latency take the latest value (not summed).
 */
export function accumulateRow(
  existing: {
    eventsIn: bigint;
    eventsOut: bigint;
    errorsTotal: bigint;
    eventsDiscarded: bigint;
    bytesIn: bigint;
    bytesOut: bigint;
  },
  delta: PerNodeRow,
): PerNodeRow {
  return {
    ...delta,
    eventsIn: existing.eventsIn + delta.eventsIn,
    eventsOut: existing.eventsOut + delta.eventsOut,
    errorsTotal: existing.errorsTotal + delta.errorsTotal,
    eventsDiscarded: existing.eventsDiscarded + delta.eventsDiscarded,
    bytesIn: existing.bytesIn + delta.bytesIn,
    bytesOut: existing.bytesOut + delta.bytesOut,
  };
}

/**
 * Ingest metrics from agent heartbeats by computing rate diffs from cumulative counters.
 *
 * Strategy (batch — minimal per-pipeline queries):
 * 1. Compute all deltas in-memory from previousSnapshots.
 * 2. Inside a $transaction:
 *    a. Read existing per-node minute rows for this node+timestamp.
 *    b. Accumulate deltas onto existing rows (or use delta as-is for new rows).
 *    c. Delete existing per-node minute rows, then insert accumulated rows.
 *    d. For each touched pipeline, read all per-node rows (including other nodes),
 *       compute aggregation in-memory.
 *    e. Delete existing aggregation rows for touched pipelines.
 *    f. Insert new aggregation rows with createMany.
 *
 * Per-minute rows accumulate across heartbeats within the same minute.
 * At 5s heartbeats, ~12 heartbeats per minute contribute to the total.
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
  const perNodeDeltas = computeDeltas(dataPoints, previousSnapshots, now);

  // Track which pipelines we touched for aggregation
  const touchedPipelineIds = [...new Set(dataPoints.map((dp) => dp.pipelineId))];

  const nodeId = dataPoints[0].nodeId;

  // 2. Execute batch writes inside a transaction
  await prisma.$transaction(async (tx) => {
    // 2a. Read existing per-node minute rows for this node+timestamp
    const existingRows = await tx.pipelineMetric.findMany({
      where: {
        nodeId,
        componentId: null,
        timestamp: now,
      },
    });

    // Index existing rows by pipelineId for O(1) lookup
    const existingByPipeline = new Map(
      existingRows.map((row) => [row.pipelineId, row]),
    );

    // 2b. Accumulate deltas onto existing rows
    const accumulatedRows = perNodeDeltas.map((delta) => {
      const existing = existingByPipeline.get(delta.pipelineId);
      return existing ? accumulateRow(existing, delta) : delta;
    });

    // 2c. Delete existing per-node minute rows, then insert accumulated rows
    if (existingRows.length > 0) {
      await tx.pipelineMetric.deleteMany({
        where: {
          nodeId,
          componentId: null,
          timestamp: now,
        },
      });
    }

    await tx.pipelineMetric.createMany({ data: accumulatedRows });

    // 2d. For each touched pipeline, gather all per-node rows and compute aggregation
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

    // 2e. Delete existing aggregation rows for touched pipelines
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

    // 2f. Insert new aggregation rows
    if (aggregationRows.length > 0) {
      await tx.pipelineMetric.createMany({ data: aggregationRows });
    }
  });
}
