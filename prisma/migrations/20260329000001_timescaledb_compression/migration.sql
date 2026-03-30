-- TimescaleDB Compression Policies
--
-- Enable native compression on hypertable chunks older than 24 hours.
-- Achieves 10-20x size reduction for time-series metric data.
-- Safe no-op on plain PostgreSQL.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN

    -- ─── PipelineMetric compression ─────────────────────────────────────
    ALTER TABLE "PipelineMetric" SET (
      timescaledb.compress,
      timescaledb.compress_segmentby = 'pipelineId',
      timescaledb.compress_orderby = 'timestamp DESC'
    );

    SELECT add_compression_policy(
      '"PipelineMetric"',
      compress_after => INTERVAL '24 hours',
      if_not_exists => true
    );

    -- ─── NodeMetric compression ─────────────────────────────────────────
    ALTER TABLE "NodeMetric" SET (
      timescaledb.compress,
      timescaledb.compress_segmentby = 'nodeId',
      timescaledb.compress_orderby = 'timestamp DESC'
    );

    SELECT add_compression_policy(
      '"NodeMetric"',
      compress_after => INTERVAL '24 hours',
      if_not_exists => true
    );

    -- ─── PipelineLog compression ────────────────────────────────────────
    ALTER TABLE "PipelineLog" SET (
      timescaledb.compress,
      timescaledb.compress_segmentby = 'pipelineId',
      timescaledb.compress_orderby = 'timestamp DESC'
    );

    SELECT add_compression_policy(
      '"PipelineLog"',
      compress_after => INTERVAL '24 hours',
      if_not_exists => true
    );

    -- ─── NodeStatusEvent compression ────────────────────────────────────
    ALTER TABLE "NodeStatusEvent" SET (
      timescaledb.compress,
      timescaledb.compress_segmentby = 'nodeId',
      timescaledb.compress_orderby = 'timestamp DESC'
    );

    SELECT add_compression_policy(
      '"NodeStatusEvent"',
      compress_after => INTERVAL '24 hours',
      if_not_exists => true
    );

    RAISE NOTICE 'TimescaleDB compression policies enabled (compress after 24h)';
  ELSE
    RAISE NOTICE 'TimescaleDB not found — skipping compression policies';
  END IF;
END
$$;
