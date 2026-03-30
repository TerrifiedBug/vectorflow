import { prisma } from "@/lib/prisma";
import { isTimescaleDbAvailable } from "@/server/services/timescaledb";

type MetricsSource = "raw" | "1m" | "1h";

/**
 * Determine which data source to use based on the requested time range
 * and TimescaleDB availability.
 *
 * - <= 60 minutes: always use raw table (most recent data, not yet aggregated)
 * - 61-1440 minutes (1h-24h): use 1-minute continuous aggregate
 * - > 1440 minutes (24h+): use 1-hour continuous aggregate
 *
 * Falls back to "raw" when TimescaleDB is not available.
 */
export function resolveMetricsSource(minutes: number): MetricsSource {
  if (!isTimescaleDbAvailable()) {
    return "raw";
  }

  if (minutes <= 60) {
    return "raw";
  }

  if (minutes <= 1440) {
    return "1m";
  }

  return "1h";
}

// ─── Pipeline Metrics ────────────────────────────────────────────────────────

export interface PipelineMetricRow {
  timestamp: Date;
  eventsIn: bigint;
  eventsOut: bigint;
  eventsDiscarded: bigint;
  errorsTotal: bigint;
  bytesIn: bigint;
  bytesOut: bigint;
  utilization: number;
  latencyMeanMs: number | null;
}

interface AggregateRow {
  bucket: Date;
  pipelineId: string;
  events_in: bigint;
  events_out: bigint;
  events_discarded: bigint;
  errors_total: bigint;
  bytes_in: bigint;
  bytes_out: bigint;
  avg_utilization: number;
  avg_latency_ms: number | null;
}

/**
 * Query pipeline metrics, automatically routing to the appropriate
 * data source (raw table or continuous aggregate) based on time range.
 */
export async function queryPipelineMetricsAggregated(input: {
  pipelineId: string;
  minutes: number;
}): Promise<{ rows: PipelineMetricRow[] }> {
  const source = resolveMetricsSource(input.minutes);
  const since = new Date(Date.now() - input.minutes * 60 * 1000);

  if (source === "raw") {
    const rows = await prisma.pipelineMetric.findMany({
      where: {
        pipelineId: input.pipelineId,
        nodeId: null,
        componentId: null,
        timestamp: { gte: since },
      },
      orderBy: { timestamp: "asc" },
      select: {
        timestamp: true,
        eventsIn: true,
        eventsOut: true,
        eventsDiscarded: true,
        errorsTotal: true,
        bytesIn: true,
        bytesOut: true,
        utilization: true,
        latencyMeanMs: true,
      },
    });

    return { rows };
  }

  // Query the continuous aggregate view
  const viewName =
    source === "1m" ? "pipeline_metrics_1m" : "pipeline_metrics_1h";

  const aggRows = await prisma.$queryRawUnsafe<AggregateRow[]>(
    `SELECT
       bucket,
       "pipelineId",
       events_in,
       events_out,
       events_discarded,
       errors_total,
       bytes_in,
       bytes_out,
       avg_utilization,
       avg_latency_ms
     FROM ${viewName}
     WHERE "pipelineId" = $1
       AND bucket >= $2
     ORDER BY bucket ASC`,
    input.pipelineId,
    since
  );

  const rows: PipelineMetricRow[] = aggRows.map((r) => ({
    timestamp: r.bucket,
    eventsIn: r.events_in,
    eventsOut: r.events_out,
    eventsDiscarded: r.events_discarded,
    errorsTotal: r.errors_total,
    bytesIn: r.bytes_in,
    bytesOut: r.bytes_out,
    utilization: r.avg_utilization,
    latencyMeanMs: r.avg_latency_ms,
  }));

  return { rows };
}

// ─── Node Metrics ────────────────────────────────────────────────────────────

export interface NodeMetricRow {
  timestamp: Date;
  nodeId: string;
  cpuSecondsTotal: number;
  cpuSecondsIdle: number;
  memoryUsedBytes: bigint;
  memoryTotalBytes: bigint;
  diskReadBytes: bigint;
  diskWrittenBytes: bigint;
  netRxBytes: bigint;
  netTxBytes: bigint;
}

interface NodeAggregateRow {
  bucket: Date;
  nodeId: string;
  avg_cpu_total: number;
  avg_cpu_idle: number;
  max_memory_used: bigint;
  max_memory_total: bigint;
  disk_read_bytes: bigint;
  disk_written_bytes: bigint;
  net_rx_bytes: bigint;
  net_tx_bytes: bigint;
}

/**
 * Query node metrics, routing to raw table or continuous aggregate.
 */
export async function queryNodeMetricsAggregated(input: {
  nodeIds: string[];
  minutes: number;
}): Promise<{ rows: NodeMetricRow[] }> {
  const source = resolveMetricsSource(input.minutes);
  const since = new Date(Date.now() - input.minutes * 60 * 1000);

  if (input.nodeIds.length === 0) {
    return { rows: [] };
  }

  if (source === "raw") {
    const rows = await prisma.nodeMetric.findMany({
      where: {
        nodeId: { in: input.nodeIds },
        timestamp: { gte: since },
      },
      orderBy: { timestamp: "asc" },
      select: {
        timestamp: true,
        nodeId: true,
        cpuSecondsTotal: true,
        cpuSecondsIdle: true,
        memoryUsedBytes: true,
        memoryTotalBytes: true,
        diskReadBytes: true,
        diskWrittenBytes: true,
        netRxBytes: true,
        netTxBytes: true,
      },
    });

    return { rows };
  }

  const viewName =
    source === "1m" ? "node_metrics_1m" : "node_metrics_1h";

  // Build parameterized IN clause
  const placeholders = input.nodeIds.map((_, i) => `$${i + 2}`).join(", ");

  const aggRows = await prisma.$queryRawUnsafe<NodeAggregateRow[]>(
    `SELECT
       bucket,
       "nodeId",
       avg_cpu_total,
       avg_cpu_idle,
       max_memory_used,
       max_memory_total,
       disk_read_bytes,
       disk_written_bytes,
       net_rx_bytes,
       net_tx_bytes
     FROM ${viewName}
     WHERE "nodeId" IN (${placeholders})
       AND bucket >= $1
     ORDER BY bucket ASC`,
    since,
    ...input.nodeIds
  );

  const rows: NodeMetricRow[] = aggRows.map((r) => ({
    timestamp: r.bucket,
    nodeId: r.nodeId,
    cpuSecondsTotal: r.avg_cpu_total,
    cpuSecondsIdle: r.avg_cpu_idle,
    memoryUsedBytes: r.max_memory_used,
    memoryTotalBytes: r.max_memory_total,
    diskReadBytes: r.disk_read_bytes,
    diskWrittenBytes: r.disk_written_bytes,
    netRxBytes: r.net_rx_bytes,
    netTxBytes: r.net_tx_bytes,
  }));

  return { rows };
}

// ─── Volume Analytics Aggregated ─────────────────────────────────────────────

export interface VolumeAggregateRow {
  bucket: Date;
  pipelineId: string;
  bytesIn: bigint;
  bytesOut: bigint;
  eventsIn: bigint;
  eventsOut: bigint;
}

/**
 * Query volume time-series data from continuous aggregates when available.
 * Used by dashboard.volumeAnalytics for the volume chart.
 */
export async function queryVolumeTimeSeries(input: {
  environmentPipelineIds: string[];
  minutes: number;
  since: Date;
}): Promise<VolumeAggregateRow[]> {
  const source = resolveMetricsSource(input.minutes);

  if (source === "raw" || input.environmentPipelineIds.length === 0) {
    // Caller should use the existing Prisma findMany path
    return [];
  }

  const viewName =
    source === "1m" ? "pipeline_metrics_1m" : "pipeline_metrics_1h";

  const placeholders = input.environmentPipelineIds
    .map((_, i) => `$${i + 2}`)
    .join(", ");

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      bucket: Date;
      pipelineId: string;
      bytes_in: bigint;
      bytes_out: bigint;
      events_in: bigint;
      events_out: bigint;
    }>
  >(
    `SELECT
       bucket,
       "pipelineId",
       bytes_in,
       bytes_out,
       events_in,
       events_out
     FROM ${viewName}
     WHERE "pipelineId" IN (${placeholders})
       AND bucket >= $1
     ORDER BY bucket ASC`,
    input.since,
    ...input.environmentPipelineIds
  );

  return rows.map((r) => ({
    bucket: r.bucket,
    pipelineId: r.pipelineId,
    bytesIn: r.bytes_in,
    bytesOut: r.bytes_out,
    eventsIn: r.events_in,
    eventsOut: r.events_out,
  }));
}
