-- TimescaleDB Compression Policies
--
-- Enable native compression on hypertable chunks older than 24 hours.
-- Achieves 10-20x size reduction for time-series metric data.
-- Safe no-op on plain PostgreSQL.
--
-- Two case-sensitivity gotchas in the option-string format:
--
-- 1. TimescaleDB's parser for compress_segmentby / compress_orderby folds
--    unquoted identifiers to lowercase, just like PostgreSQL's regclass
--    parser. Columns like "pipelineId" / "nodeId" / "timestamp" / "id" must
--    be wrapped in double quotes inside the string literal — otherwise we
--    get "column pipelineid does not exist".
--
-- 2. Every column of the hypertable's primary key (changed to ("id",
--    "timestamp") in the previous migration) must appear in either
--    compress_segmentby or compress_orderby. We put "id" in orderby —
--    segmenting by a high-cardinality cuid would create one segment per
--    row and destroy the compression ratio.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN

    -- ─── PipelineMetric compression ─────────────────────────────────────
    ALTER TABLE "PipelineMetric" SET (
      timescaledb.compress,
      timescaledb.compress_segmentby = '"pipelineId"',
      timescaledb.compress_orderby = '"timestamp" DESC, "id"'
    );

    PERFORM add_compression_policy(
      '"PipelineMetric"',
      compress_after => INTERVAL '24 hours',
      if_not_exists => true
    );

    -- ─── NodeMetric compression ─────────────────────────────────────────
    ALTER TABLE "NodeMetric" SET (
      timescaledb.compress,
      timescaledb.compress_segmentby = '"nodeId"',
      timescaledb.compress_orderby = '"timestamp" DESC, "id"'
    );

    PERFORM add_compression_policy(
      '"NodeMetric"',
      compress_after => INTERVAL '24 hours',
      if_not_exists => true
    );

    -- ─── PipelineLog compression ────────────────────────────────────────
    ALTER TABLE "PipelineLog" SET (
      timescaledb.compress,
      timescaledb.compress_segmentby = '"pipelineId"',
      timescaledb.compress_orderby = '"timestamp" DESC, "id"'
    );

    PERFORM add_compression_policy(
      '"PipelineLog"',
      compress_after => INTERVAL '24 hours',
      if_not_exists => true
    );

    -- ─── NodeStatusEvent compression ────────────────────────────────────
    ALTER TABLE "NodeStatusEvent" SET (
      timescaledb.compress,
      timescaledb.compress_segmentby = '"nodeId"',
      timescaledb.compress_orderby = '"timestamp" DESC, "id"'
    );

    PERFORM add_compression_policy(
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
