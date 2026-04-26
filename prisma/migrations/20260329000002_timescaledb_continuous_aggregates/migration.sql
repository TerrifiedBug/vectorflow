-- TimescaleDB Continuous Aggregates
--
-- Pre-compute downsampled metrics for efficient dashboard queries.
-- 1-minute rollups: used for 1h-24h views (instead of raw rows)
-- 1-hour rollups: used for 7d+ views
--
-- Safe no-op on plain PostgreSQL.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN

    -- ═══════════════════════════════════════════════════════════════════════
    -- PipelineMetric — 1-minute rollup
    -- ═══════════════════════════════════════════════════════════════════════

    CREATE MATERIALIZED VIEW IF NOT EXISTS "pipeline_metrics_1m"
    WITH (timescaledb.continuous) AS
    SELECT
      time_bucket('1 minute', "timestamp") AS bucket,
      "pipelineId",
      SUM("eventsIn")::bigint         AS events_in,
      SUM("eventsOut")::bigint         AS events_out,
      SUM("eventsDiscarded")::bigint   AS events_discarded,
      SUM("errorsTotal")::bigint       AS errors_total,
      SUM("bytesIn")::bigint           AS bytes_in,
      SUM("bytesOut")::bigint          AS bytes_out,
      AVG("utilization")               AS avg_utilization,
      AVG("latencyMeanMs")             AS avg_latency_ms
    FROM "PipelineMetric"
    WHERE "nodeId" IS NULL AND "componentId" IS NULL
    GROUP BY bucket, "pipelineId"
    WITH NO DATA;

    -- Refresh policy: refresh data older than 2 minutes, look back 1 hour
    PERFORM add_continuous_aggregate_policy('pipeline_metrics_1m',
      start_offset    => INTERVAL '1 hour',
      end_offset      => INTERVAL '2 minutes',
      schedule_interval => INTERVAL '1 minute',
      if_not_exists   => true
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- PipelineMetric — 1-hour rollup
    -- ═══════════════════════════════════════════════════════════════════════

    CREATE MATERIALIZED VIEW IF NOT EXISTS "pipeline_metrics_1h"
    WITH (timescaledb.continuous) AS
    SELECT
      time_bucket('1 hour', "timestamp") AS bucket,
      "pipelineId",
      SUM("eventsIn")::bigint         AS events_in,
      SUM("eventsOut")::bigint         AS events_out,
      SUM("eventsDiscarded")::bigint   AS events_discarded,
      SUM("errorsTotal")::bigint       AS errors_total,
      SUM("bytesIn")::bigint           AS bytes_in,
      SUM("bytesOut")::bigint          AS bytes_out,
      AVG("utilization")               AS avg_utilization,
      AVG("latencyMeanMs")             AS avg_latency_ms
    FROM "PipelineMetric"
    WHERE "nodeId" IS NULL AND "componentId" IS NULL
    GROUP BY bucket, "pipelineId"
    WITH NO DATA;

    PERFORM add_continuous_aggregate_policy('pipeline_metrics_1h',
      start_offset    => INTERVAL '3 hours',
      end_offset      => INTERVAL '1 hour',
      schedule_interval => INTERVAL '1 hour',
      if_not_exists   => true
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- NodeMetric — 1-minute rollup
    -- ═══════════════════════════════════════════════════════════════════════

    CREATE MATERIALIZED VIEW IF NOT EXISTS "node_metrics_1m"
    WITH (timescaledb.continuous) AS
    SELECT
      time_bucket('1 minute', "timestamp") AS bucket,
      "nodeId",
      AVG("cpuSecondsTotal")               AS avg_cpu_total,
      AVG("cpuSecondsIdle")                AS avg_cpu_idle,
      AVG(("memoryUsedBytes")::float8 /
          NULLIF(("memoryTotalBytes")::float8, 0) * 100)
                                            AS avg_memory_pct,
      MAX("memoryUsedBytes")::bigint       AS max_memory_used,
      MAX("memoryTotalBytes")::bigint      AS max_memory_total,
      AVG("loadAvg1")                      AS avg_load1,
      AVG("loadAvg5")                      AS avg_load5,
      AVG("loadAvg15")                     AS avg_load15,
      SUM("diskReadBytes")::bigint         AS disk_read_bytes,
      SUM("diskWrittenBytes")::bigint      AS disk_written_bytes,
      SUM("netRxBytes")::bigint            AS net_rx_bytes,
      SUM("netTxBytes")::bigint            AS net_tx_bytes
    FROM "NodeMetric"
    GROUP BY bucket, "nodeId"
    WITH NO DATA;

    PERFORM add_continuous_aggregate_policy('node_metrics_1m',
      start_offset    => INTERVAL '1 hour',
      end_offset      => INTERVAL '2 minutes',
      schedule_interval => INTERVAL '1 minute',
      if_not_exists   => true
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- NodeMetric — 1-hour rollup
    -- ═══════════════════════════════════════════════════════════════════════

    CREATE MATERIALIZED VIEW IF NOT EXISTS "node_metrics_1h"
    WITH (timescaledb.continuous) AS
    SELECT
      time_bucket('1 hour', "timestamp") AS bucket,
      "nodeId",
      AVG("cpuSecondsTotal")               AS avg_cpu_total,
      AVG("cpuSecondsIdle")                AS avg_cpu_idle,
      AVG(("memoryUsedBytes")::float8 /
          NULLIF(("memoryTotalBytes")::float8, 0) * 100)
                                            AS avg_memory_pct,
      MAX("memoryUsedBytes")::bigint       AS max_memory_used,
      MAX("memoryTotalBytes")::bigint      AS max_memory_total,
      AVG("loadAvg1")                      AS avg_load1,
      AVG("loadAvg5")                      AS avg_load5,
      AVG("loadAvg15")                     AS avg_load15,
      SUM("diskReadBytes")::bigint         AS disk_read_bytes,
      SUM("diskWrittenBytes")::bigint      AS disk_written_bytes,
      SUM("netRxBytes")::bigint            AS net_rx_bytes,
      SUM("netTxBytes")::bigint            AS net_tx_bytes
    FROM "NodeMetric"
    GROUP BY bucket, "nodeId"
    WITH NO DATA;

    PERFORM add_continuous_aggregate_policy('node_metrics_1h',
      start_offset    => INTERVAL '3 hours',
      end_offset      => INTERVAL '1 hour',
      schedule_interval => INTERVAL '1 hour',
      if_not_exists   => true
    );

    RAISE NOTICE 'Continuous aggregates created: pipeline_metrics_1m, pipeline_metrics_1h, node_metrics_1m, node_metrics_1h';
  ELSE
    RAISE NOTICE 'TimescaleDB not found — skipping continuous aggregates';
  END IF;
END
$$;
