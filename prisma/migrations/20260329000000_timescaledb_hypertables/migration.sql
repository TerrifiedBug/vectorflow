-- TimescaleDB Hypertable Migration
--
-- This migration is safe to run on plain PostgreSQL — every TimescaleDB call
-- is wrapped in a DO block that checks for the extension first.
-- If TimescaleDB is not installed, the migration is a no-op.

DO $$
BEGIN
  -- Only proceed if TimescaleDB extension is available
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN

    -- ─── PipelineMetric ──────────────────────────────────────────────────
    -- Drop the Prisma-generated primary key (cuid id) because TimescaleDB
    -- requires the partitioning column (timestamp) in any unique index.
    -- We keep the id column for Prisma compatibility but remove uniqueness.

    ALTER TABLE "PipelineMetric" DROP CONSTRAINT IF EXISTS "PipelineMetric_pkey";

    -- Create a composite primary key including timestamp
    ALTER TABLE "PipelineMetric"
      ADD CONSTRAINT "PipelineMetric_pkey" PRIMARY KEY ("id", "timestamp");

    PERFORM create_hypertable(
      'PipelineMetric',
      by_range('timestamp', INTERVAL '1 day'),
      migrate_data => true,
      if_not_exists => true
    );

    -- ─── NodeMetric ──────────────────────────────────────────────────────

    ALTER TABLE "NodeMetric" DROP CONSTRAINT IF EXISTS "NodeMetric_pkey";

    ALTER TABLE "NodeMetric"
      ADD CONSTRAINT "NodeMetric_pkey" PRIMARY KEY ("id", "timestamp");

    PERFORM create_hypertable(
      'NodeMetric',
      by_range('timestamp', INTERVAL '1 day'),
      migrate_data => true,
      if_not_exists => true
    );

    -- ─── PipelineLog ─────────────────────────────────────────────────────

    ALTER TABLE "PipelineLog" DROP CONSTRAINT IF EXISTS "PipelineLog_pkey";
    ALTER TABLE "PipelineLog"
      ADD CONSTRAINT "PipelineLog_pkey" PRIMARY KEY ("id", "timestamp");

    PERFORM create_hypertable(
      'PipelineLog',
      by_range('timestamp', INTERVAL '1 day'),
      migrate_data => true,
      if_not_exists => true
    );

    -- ─── NodeStatusEvent ─────────────────────────────────────────────────

    ALTER TABLE "NodeStatusEvent" DROP CONSTRAINT IF EXISTS "NodeStatusEvent_pkey";
    ALTER TABLE "NodeStatusEvent"
      ADD CONSTRAINT "NodeStatusEvent_pkey" PRIMARY KEY ("id", "timestamp");

    PERFORM create_hypertable(
      'NodeStatusEvent',
      by_range('timestamp', INTERVAL '1 day'),
      migrate_data => true,
      if_not_exists => true
    );

    RAISE NOTICE 'TimescaleDB hypertables created for PipelineMetric, NodeMetric, PipelineLog, NodeStatusEvent';
  ELSE
    RAISE NOTICE 'TimescaleDB extension not found — skipping hypertable creation (plain PostgreSQL mode)';
  END IF;
END
$$;
