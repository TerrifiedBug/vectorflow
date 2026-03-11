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
        eventsDiscarded: true,
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
    const deltaDiscarded = clamp(dp.eventsDiscarded, prev?.eventsDiscarded);
    const deltaBytesIn = clamp(dp.bytesIn, prev?.bytesIn);
    const deltaBytesOut = clamp(dp.bytesOut, prev?.bytesOut);

    // Upsert per-node, per-minute rollup
    const existing = await prisma.pipelineMetric.findFirst({
      where: {
        pipelineId: dp.pipelineId,
        nodeId: dp.nodeId,
        componentId: null,
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
          eventsDiscarded: { increment: deltaDiscarded },
          bytesIn: { increment: deltaBytesIn },
          bytesOut: { increment: deltaBytesOut },
          utilization: dp.utilization,
          ...(dp.latencyMeanMs != null ? { latencyMeanMs: dp.latencyMeanMs } : {}),
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
          eventsDiscarded: deltaDiscarded,
          bytesIn: deltaBytesIn,
          bytesOut: deltaBytesOut,
          utilization: dp.utilization,
          ...(dp.latencyMeanMs != null ? { latencyMeanMs: dp.latencyMeanMs } : {}),
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
        componentId: null,
        timestamp: now,
      },
    });

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
    const avgLatencyMs = latencyWeightCount > 0 ? latencyWeightedSum / latencyWeightCount : null;

    const existingAgg = await prisma.pipelineMetric.findFirst({
      where: {
        pipelineId,
        nodeId: null,
        componentId: null,
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
          eventsDiscarded: totalDiscarded,
          bytesIn: totalBytesIn,
          bytesOut: totalBytesOut,
          utilization: avgUtil,
          ...(avgLatencyMs != null ? { latencyMeanMs: avgLatencyMs } : {}),
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
          eventsDiscarded: totalDiscarded,
          bytesIn: totalBytesIn,
          bytesOut: totalBytesOut,
          utilization: avgUtil,
          ...(avgLatencyMs != null ? { latencyMeanMs: avgLatencyMs } : {}),
        },
      });
    }
  }
}
