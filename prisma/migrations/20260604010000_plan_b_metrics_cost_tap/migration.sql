-- Plan B (metrics rollups, cost intelligence, live-tap captures).
--
-- Additive: a new RecommendationType value (HIGH_CARDINALITY), a long-retention
-- setting, and four new tenant tables:
--   DestinationCostModel  — per-org per-sink $/GB price model (B3)
--   NodeMetricRollup      — downsampled node metrics (B5)
--   PipelineMetricRollup  — downsampled pipeline metrics (B5)
--   TapCapture            — persisted named live-tap captures (B4)
-- RLS is installed on all four (strict per-table policy, matching
-- 20260521000000). New tables created by the migrating owner inherit
-- vectorflow_app grants via ALTER DEFAULT PRIVILEGES (20260516000006).
--
-- ALTER TYPE ... ADD VALUE runs fine inside the migration transaction on PG12+
-- because the new value is not USED within this migration.

-- ─── 1. Enum + settings column ───────────────────────────────────────────────
ALTER TYPE "RecommendationType" ADD VALUE 'HIGH_CARDINALITY';

ALTER TABLE "OrganizationSettings" ADD COLUMN     "metricsRollupRetentionDays" INTEGER NOT NULL DEFAULT 90;

-- ─── 2. New tables ───────────────────────────────────────────────────────────
CREATE TABLE "DestinationCostModel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT 'default',
    "sinkType" TEXT NOT NULL,
    "label" TEXT,
    "pricePerGbCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DestinationCostModel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NodeMetricRollup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT 'default',
    "nodeId" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "granularity" TEXT NOT NULL,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "memoryUsedBytes" BIGINT NOT NULL DEFAULT 0,
    "memoryTotalBytes" BIGINT NOT NULL DEFAULT 0,
    "cpuSecondsTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cpuSecondsIdle" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "loadAvg1" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "loadAvg5" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "loadAvg15" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fsUsedBytes" BIGINT NOT NULL DEFAULT 0,
    "fsTotalBytes" BIGINT NOT NULL DEFAULT 0,
    "diskReadBytes" BIGINT NOT NULL DEFAULT 0,
    "diskWrittenBytes" BIGINT NOT NULL DEFAULT 0,
    "netRxBytes" BIGINT NOT NULL DEFAULT 0,
    "netTxBytes" BIGINT NOT NULL DEFAULT 0,
    "maxMemoryUsedBytes" BIGINT NOT NULL DEFAULT 0,
    "maxLoadAvg1" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "NodeMetricRollup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PipelineMetricRollup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT 'default',
    "pipelineId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL DEFAULT '',
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "granularity" TEXT NOT NULL,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "eventsIn" BIGINT NOT NULL DEFAULT 0,
    "eventsOut" BIGINT NOT NULL DEFAULT 0,
    "eventsDiscarded" BIGINT NOT NULL DEFAULT 0,
    "errorsTotal" BIGINT NOT NULL DEFAULT 0,
    "bytesIn" BIGINT NOT NULL DEFAULT 0,
    "bytesOut" BIGINT NOT NULL DEFAULT 0,
    "utilization" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMeanMs" DOUBLE PRECISION,
    "maxLatencyMs" DOUBLE PRECISION,
    CONSTRAINT "PipelineMetricRollup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TapCapture" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT 'default',
    "pipelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "componentKey" TEXT NOT NULL,
    "events" JSONB NOT NULL,
    "schema" JSONB NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TapCapture_pkey" PRIMARY KEY ("id")
);

-- ─── 3. Indexes ──────────────────────────────────────────────────────────────
CREATE INDEX "DestinationCostModel_organizationId_idx" ON "DestinationCostModel"("organizationId");
CREATE UNIQUE INDEX "DestinationCostModel_organizationId_sinkType_key" ON "DestinationCostModel"("organizationId", "sinkType");
CREATE INDEX "NodeMetricRollup_nodeId_granularity_bucketStart_idx" ON "NodeMetricRollup"("nodeId", "granularity", "bucketStart");
CREATE INDEX "NodeMetricRollup_organizationId_idx" ON "NodeMetricRollup"("organizationId");
CREATE UNIQUE INDEX "NodeMetricRollup_nodeId_granularity_bucketStart_key" ON "NodeMetricRollup"("nodeId", "granularity", "bucketStart");
CREATE INDEX "PipelineMetricRollup_pipelineId_granularity_bucketStart_idx" ON "PipelineMetricRollup"("pipelineId", "granularity", "bucketStart");
CREATE INDEX "PipelineMetricRollup_organizationId_idx" ON "PipelineMetricRollup"("organizationId");
CREATE UNIQUE INDEX "PipelineMetricRollup_pipelineId_componentId_granularity_buc_key" ON "PipelineMetricRollup"("pipelineId", "componentId", "granularity", "bucketStart");
CREATE INDEX "TapCapture_organizationId_idx" ON "TapCapture"("organizationId");
CREATE INDEX "TapCapture_pipelineId_idx" ON "TapCapture"("pipelineId");

-- ─── 4. Foreign keys ─────────────────────────────────────────────────────────
ALTER TABLE "NodeMetricRollup" ADD CONSTRAINT "NodeMetricRollup_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "VectorNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PipelineMetricRollup" ADD CONSTRAINT "PipelineMetricRollup_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TapCapture" ADD CONSTRAINT "TapCapture_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TapCapture" ADD CONSTRAINT "TapCapture_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── 5. Row-level security (strict per-table policy) ─────────────────────────
DO $$
DECLARE
    tbl text;
    tenant_tables text[] := ARRAY[
        'DestinationCostModel',
        'NodeMetricRollup',
        'PipelineMetricRollup',
        'TapCapture'
    ];
BEGIN
    FOREACH tbl IN ARRAY tenant_tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', tbl || '_org_isolation', tbl);
        EXECUTE format($p$
            CREATE POLICY %I ON %I
            USING ("organizationId" = current_setting('app.org_id', true))
            WITH CHECK ("organizationId" = current_setting('app.org_id', true));
        $p$, tbl || '_org_isolation', tbl);
    END LOOP;
    RAISE NOTICE 'plan-b: RLS installed on DestinationCostModel, NodeMetricRollup, PipelineMetricRollup, TapCapture';
END $$;
