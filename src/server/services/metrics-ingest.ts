import { prisma } from "@/lib/prisma";

export interface MetricsDataPoint {
  nodeId: string;
  pipelineId: string;
  eventsIn: bigint;
  eventsOut: bigint;
  errorsTotal: bigint;
  bytesIn: bigint;
  bytesOut: bigint;
  utilization: number;
}

export interface PreviousSnapshot {
  eventsIn: bigint;
  eventsOut: bigint;
  errorsTotal: bigint;
  bytesIn: bigint;
  bytesOut: bigint;
}

/**
 * Ingest metrics from agent heartbeats by computing rate diffs from cumulative counters.
 *
 * For each pipeline status reported:
 * - Look up the previous snapshot in NodePipelineStatus
 * - Compute delta (current - previous, clamped to 0 for counter resets)
 * - Upsert per-minute rollup into PipelineMetric (per-node rows)
 * - After processing all, aggregate per-pipeline rollups (nodeId: null)
 */
export async function ingestMetrics(
  dataPoints: MetricsDataPoint[],
  previousSnapshots?: Map<string, PreviousSnapshot>,
): Promise<void> {
  // Round timestamp to current minute
  const now = new Date();
  now.setSeconds(0, 0);

  // Track which pipelines we touched for aggregation
  const touchedPipelines = new Set<string>();

  for (const dp of dataPoints) {
    // Use passed-in previous snapshot (read before upsert) or fall back to DB lookup
    const snapshotKey = `${dp.nodeId}:${dp.pipelineId}`;
    const prev = previousSnapshots?.get(snapshotKey) ?? await prisma.nodePipelineStatus.findUnique({
      where: {
        nodeId_pipelineId: {
          nodeId: dp.nodeId,
          pipelineId: dp.pipelineId,
        },
      },
      select: {
        eventsIn: true,
        eventsOut: true,
        errorsTotal: true,
        bytesIn: true,
        bytesOut: true,
      },
    });

    // Compute deltas, clamping to 0 for counter resets
    const clamp = (curr: bigint, prevVal: bigint | null | undefined): bigint => {
      if (prevVal == null) return BigInt(0);
      const diff = curr - prevVal;
      return diff < BigInt(0) ? BigInt(0) : diff;
    };

    const deltaEventsIn = clamp(dp.eventsIn, prev?.eventsIn);
    const deltaEventsOut = clamp(dp.eventsOut, prev?.eventsOut);
    const deltaErrors = clamp(dp.errorsTotal, prev?.errorsTotal);
    const deltaBytesIn = clamp(dp.bytesIn, prev?.bytesIn);
    const deltaBytesOut = clamp(dp.bytesOut, prev?.bytesOut);

    // Upsert per-node, per-minute rollup
    const existing = await prisma.pipelineMetric.findFirst({
      where: {
        pipelineId: dp.pipelineId,
        nodeId: dp.nodeId,
        timestamp: now,
      },
    });

    if (existing) {
      await prisma.pipelineMetric.update({
        where: { id: existing.id },
        data: {
          eventsIn: { increment: deltaEventsIn },
          eventsOut: { increment: deltaEventsOut },
          errorsTotal: { increment: deltaErrors },
          bytesIn: { increment: deltaBytesIn },
          bytesOut: { increment: deltaBytesOut },
          utilization: dp.utilization,
        },
      });
    } else {
      await prisma.pipelineMetric.create({
        data: {
          pipelineId: dp.pipelineId,
          nodeId: dp.nodeId,
          timestamp: now,
          eventsIn: deltaEventsIn,
          eventsOut: deltaEventsOut,
          errorsTotal: deltaErrors,
          bytesIn: deltaBytesIn,
          bytesOut: deltaBytesOut,
          utilization: dp.utilization,
        },
      });
    }

    touchedPipelines.add(dp.pipelineId);
  }

  // Aggregate per-pipeline rollups (nodeId: null)
  for (const pipelineId of touchedPipelines) {
    const nodeRows = await prisma.pipelineMetric.findMany({
      where: {
        pipelineId,
        nodeId: { not: null },
        timestamp: now,
      },
    });

    let totalEventsIn = BigInt(0);
    let totalEventsOut = BigInt(0);
    let totalErrors = BigInt(0);
    let totalBytesIn = BigInt(0);
    let totalBytesOut = BigInt(0);
    let totalUtil = 0;

    for (const row of nodeRows) {
      totalEventsIn += row.eventsIn;
      totalEventsOut += row.eventsOut;
      totalErrors += row.errorsTotal;
      totalBytesIn += row.bytesIn;
      totalBytesOut += row.bytesOut;
      totalUtil += row.utilization;
    }

    const avgUtil = nodeRows.length > 0 ? totalUtil / nodeRows.length : 0;

    const existingAgg = await prisma.pipelineMetric.findFirst({
      where: {
        pipelineId,
        nodeId: null,
        timestamp: now,
      },
    });

    if (existingAgg) {
      await prisma.pipelineMetric.update({
        where: { id: existingAgg.id },
        data: {
          eventsIn: totalEventsIn,
          eventsOut: totalEventsOut,
          errorsTotal: totalErrors,
          bytesIn: totalBytesIn,
          bytesOut: totalBytesOut,
          utilization: avgUtil,
        },
      });
    } else {
      await prisma.pipelineMetric.create({
        data: {
          pipelineId,
          nodeId: null,
          timestamp: now,
          eventsIn: totalEventsIn,
          eventsOut: totalEventsOut,
          errorsTotal: totalErrors,
          bytesIn: totalBytesIn,
          bytesOut: totalBytesOut,
          utilization: avgUtil,
        },
      });
    }
  }
}
