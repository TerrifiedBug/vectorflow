-- Trace-aware metrics (A7) + BYO lake bucket (A5).
--
-- Additive: span/trace volume columns on the metric + rollup tables, a new
-- cost recommendation type, and a per-environment external lake bucket
-- (tenant table with strict RLS; vectorflow_app grants inherited via ALTER
-- DEFAULT PRIVILEGES). ADD VALUE runs inside the migration tx on PG12+ (the
-- value is not USED here).

ALTER TYPE "RecommendationType" ADD VALUE 'TRACE_TAIL_SAMPLE';

ALTER TABLE "PipelineMetric" ADD COLUMN     "spansIn" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "spansOut" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "tracesIn" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "PipelineMetricRollup" ADD COLUMN     "spansIn" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "spansOut" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "tracesIn" BIGINT NOT NULL DEFAULT 0;

CREATE TABLE "EnvironmentLakeBucket" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT 'default',
    "environmentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "region" TEXT,
    "endpoint" TEXT,
    "prefix" TEXT,
    "encryptedAccessKeyId" TEXT,
    "encryptedSecretAccessKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EnvironmentLakeBucket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EnvironmentLakeBucket_environmentId_key" ON "EnvironmentLakeBucket"("environmentId");
CREATE INDEX "EnvironmentLakeBucket_organizationId_idx" ON "EnvironmentLakeBucket"("organizationId");

ALTER TABLE "EnvironmentLakeBucket" ADD CONSTRAINT "EnvironmentLakeBucket_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
    EXECUTE 'ALTER TABLE "EnvironmentLakeBucket" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "EnvironmentLakeBucket_org_isolation" ON "EnvironmentLakeBucket"';
    EXECUTE $p$
        CREATE POLICY "EnvironmentLakeBucket_org_isolation" ON "EnvironmentLakeBucket"
        USING ("organizationId" = current_setting('app.org_id', true))
        WITH CHECK ("organizationId" = current_setting('app.org_id', true));
    $p$;
    RAISE NOTICE 'trace-metrics-byo-bucket: RLS installed on EnvironmentLakeBucket';
END $$;
