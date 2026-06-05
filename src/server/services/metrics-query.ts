import { prisma } from "@/lib/prisma";
import { isTimescaleDbAvailable } from "@/server/services/timescaledb";
import type { RollupGranularity } from "@/server/services/metrics-rollup";

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

/**
 * Ranges longer than the default raw-retention window (`metricsRetentionDays`,
 * 7d) cannot be served from raw rows or the TimescaleDB continuous aggregates
 * (both purged with the raw chunks). Those ranges read the long-retention
 * downsampled rollup tables instead. Kept as fixed constants so the hot query
 * path needs no per-request settings read; matches the default raw retention.
 */
const ROLLUP_MIN_RANGE_MINUTES = 7 * 24 * 60; // 7 days
const ROLLUP_DAY_RANGE_MINUTES = 14 * 24 * 60; // 14 days

/**
 * Pick the rollup granularity for a requested range, or `null` when the range is
 * short/recent enough to serve from raw or continuous-aggregate sources.
 */
export function resolveRollupGranularity(
  minutes: number,
): RollupGranularity | null {
  if (minutes <= ROLLUP_MIN_RANGE_MINUTES) return null;
  return minutes > ROLLUP_DAY_RANGE_MINUTES ? "DAY" : "HOUR";
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

interface EnvironmentAggregateRow {
  bucket: Date;
  events_in: bigint;
  events_out: bigint;
  events_discarded: bigint;
  errors_total: bigint;
  bytes_in: bigint;
  bytes_out: bigint;
  avg_utilization: number | null;
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

  const rollupGranularity = resolveRollupGranularity(input.minutes);
  if (rollupGranularity) {
    const rollupRows = await prisma.pipelineMetricRollup.findMany({
      where: {
        pipelineId: input.pipelineId,
        componentId: "", // "" = pipeline aggregate (mirrors nodeId/componentId null)
        granularity: rollupGranularity,
        bucketStart: { gte: since },
      },
      orderBy: { bucketStart: "asc" },
      select: {
        bucketStart: true,
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

    return {
      rows: rollupRows.map((r) => ({
        timestamp: r.bucketStart,
        eventsIn: r.eventsIn,
        eventsOut: r.eventsOut,
        eventsDiscarded: r.eventsDiscarded,
        errorsTotal: r.errorsTotal,
        bytesIn: r.bytesIn,
        bytesOut: r.bytesOut,
        utilization: r.utilization,
        latencyMeanMs: r.latencyMeanMs,
      })),
    };
  }

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

/**
 * Query environment-level pipeline metrics by aggregating all pipeline-level
 * rows for pipelines in the environment into a single time series.
 */
export async function queryEnvironmentPipelineMetricsAggregated(input: {
  environmentId: string;
  minutes: number;
}): Promise<{ rows: PipelineMetricRow[] }> {
  const source = resolveMetricsSource(input.minutes);
  const since = new Date(Date.now() - input.minutes * 60 * 1000);

  const rollupGranularity = resolveRollupGranularity(input.minutes);
  if (rollupGranularity) {
    const aggRows = await prisma.$queryRawUnsafe<EnvironmentAggregateRow[]>(
      `SELECT
         r."bucketStart" AS bucket,
         SUM(r."eventsIn")::bigint AS events_in,
         SUM(r."eventsOut")::bigint AS events_out,
         SUM(r."eventsDiscarded")::bigint AS events_discarded,
         SUM(r."errorsTotal")::bigint AS errors_total,
         SUM(r."bytesIn")::bigint AS bytes_in,
         SUM(r."bytesOut")::bigint AS bytes_out,
         AVG(r.utilization) AS avg_utilization,
         AVG(r."latencyMeanMs") AS avg_latency_ms
       FROM "PipelineMetricRollup" r
       JOIN "Pipeline" p ON p.id = r."pipelineId"
       WHERE p."environmentId" = $1
         AND r."componentId" = ''
         AND r.granularity = $2
         AND r."bucketStart" >= $3
       GROUP BY r."bucketStart"
       ORDER BY r."bucketStart" ASC`,
      input.environmentId,
      rollupGranularity,
      since,
    );

    return {
      rows: aggRows.map((r) => ({
        timestamp: r.bucket,
        eventsIn: r.events_in,
        eventsOut: r.events_out,
        eventsDiscarded: r.events_discarded,
        errorsTotal: r.errors_total,
        bytesIn: r.bytes_in,
        bytesOut: r.bytes_out,
        utilization: r.avg_utilization ?? 0,
        latencyMeanMs: r.avg_latency_ms,
      })),
    };
  }

  if (source === "raw") {
    const rows = await prisma.$queryRawUnsafe<EnvironmentAggregateRow[]>(
      `SELECT
         date_trunc('minute', pm.timestamp) AS bucket,
         SUM(pm."eventsIn")::bigint AS events_in,
         SUM(pm."eventsOut")::bigint AS events_out,
         SUM(pm."eventsDiscarded")::bigint AS events_discarded,
         SUM(pm."errorsTotal")::bigint AS errors_total,
         SUM(pm."bytesIn")::bigint AS bytes_in,
         SUM(pm."bytesOut")::bigint AS bytes_out,
         AVG(pm.utilization) AS avg_utilization,
         AVG(pm."latencyMeanMs") AS avg_latency_ms
       FROM "PipelineMetric" pm
       JOIN "Pipeline" p ON p.id = pm."pipelineId"
       WHERE p."environmentId" = $1
         AND pm."nodeId" IS NULL
         AND pm."componentId" IS NULL
         AND pm.timestamp >= $2
       GROUP BY bucket
       ORDER BY bucket ASC`,
      input.environmentId,
      since,
    );

    return {
      rows: rows.map((r) => ({
        timestamp: r.bucket,
        eventsIn: r.events_in,
        eventsOut: r.events_out,
        eventsDiscarded: r.events_discarded,
        errorsTotal: r.errors_total,
        bytesIn: r.bytes_in,
        bytesOut: r.bytes_out,
        utilization: r.avg_utilization ?? 0,
        latencyMeanMs: r.avg_latency_ms,
      })),
    };
  }

  const viewName =
    source === "1m" ? "pipeline_metrics_1m" : "pipeline_metrics_1h";

  const aggRows = await prisma.$queryRawUnsafe<EnvironmentAggregateRow[]>(
    `SELECT
       m.bucket,
       SUM(m.events_in)::bigint AS events_in,
       SUM(m.events_out)::bigint AS events_out,
       SUM(m.events_discarded)::bigint AS events_discarded,
       SUM(m.errors_total)::bigint AS errors_total,
       SUM(m.bytes_in)::bigint AS bytes_in,
       SUM(m.bytes_out)::bigint AS bytes_out,
       AVG(m.avg_utilization) AS avg_utilization,
       AVG(m.avg_latency_ms) AS avg_latency_ms
     FROM ${viewName} m
     JOIN "Pipeline" p ON p.id = m."pipelineId"
     WHERE p."environmentId" = $1
       AND m.bucket >= $2
     GROUP BY m.bucket
     ORDER BY m.bucket ASC`,
    input.environmentId,
    since,
  );

  return {
    rows: aggRows.map((r) => ({
      timestamp: r.bucket,
      eventsIn: r.events_in,
      eventsOut: r.events_out,
      eventsDiscarded: r.events_discarded,
      errorsTotal: r.errors_total,
      bytesIn: r.bytes_in,
      bytesOut: r.bytes_out,
      utilization: r.avg_utilization ?? 0,
      latencyMeanMs: r.avg_latency_ms,
    })),
  };
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

  const rollupGranularity = resolveRollupGranularity(input.minutes);
  if (rollupGranularity) {
    const rollupRows = await prisma.nodeMetricRollup.findMany({
      where: {
        nodeId: { in: input.nodeIds },
        granularity: rollupGranularity,
        bucketStart: { gte: since },
      },
      orderBy: { bucketStart: "asc" },
      select: {
        bucketStart: true,
        nodeId: true,
        cpuSecondsTotal: true,
        cpuSecondsIdle: true,
        memoryUsedBytes: true,
        memoryTotalBytes: true,
        maxMemoryUsedBytes: true,
        diskReadBytes: true,
        diskWrittenBytes: true,
        netRxBytes: true,
        netTxBytes: true,
      },
    });

    return {
      rows: rollupRows.map((r) => ({
        timestamp: r.bucketStart,
        nodeId: r.nodeId,
        cpuSecondsTotal: r.cpuSecondsTotal,
        cpuSecondsIdle: r.cpuSecondsIdle,
        // Peak (not average) memory mirrors the continuous-aggregate path's
        // max_memory_used mapping so long-range charts stay consistent.
        memoryUsedBytes: r.maxMemoryUsedBytes,
        memoryTotalBytes: r.memoryTotalBytes,
        diskReadBytes: r.diskReadBytes,
        diskWrittenBytes: r.diskWrittenBytes,
        netRxBytes: r.netRxBytes,
        netTxBytes: r.netTxBytes,
      })),
    };
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

  const rollupGranularity = resolveRollupGranularity(input.minutes);
  if (rollupGranularity && input.environmentPipelineIds.length > 0) {
    const placeholders = input.environmentPipelineIds
      .map((_, i) => `$${i + 3}`)
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
         "bucketStart" AS bucket,
         "pipelineId",
         "bytesIn" AS bytes_in,
         "bytesOut" AS bytes_out,
         "eventsIn" AS events_in,
         "eventsOut" AS events_out
       FROM "PipelineMetricRollup"
       WHERE "pipelineId" IN (${placeholders})
         AND "componentId" = ''
         AND granularity = $2
         AND "bucketStart" >= $1
       ORDER BY "bucketStart" ASC`,
      input.since,
      rollupGranularity,
      ...input.environmentPipelineIds,
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
