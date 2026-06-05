-- VectorFlow Lake scheduled threshold alerts (A6).
--
-- One tenant table with strict RLS (matching 20260604030000_lake_catalog).
-- A saved summarize/search spec is evaluated on a cadence; crossing the
-- threshold (edge-triggered) fires via a notification channel. Firing state
-- lives on the row. vectorflow_app grants are inherited via ALTER DEFAULT
-- PRIVILEGES (set up in the org RLS migration).

-- CreateTable
CREATE TABLE "LakeAlertRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT 'default',
    "pipelineId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "comparator" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "intervalSeconds" INTEGER NOT NULL DEFAULT 300,
    "channelId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastEvaluatedAt" TIMESTAMP(3),
    "lastFiredAt" TIMESTAMP(3),
    "lastValue" DOUBLE PRECISION,
    "firing" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LakeAlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LakeAlertRule_organizationId_enabled_lastEvaluatedAt_idx" ON "LakeAlertRule"("organizationId", "enabled", "lastEvaluatedAt");

-- CreateIndex
CREATE INDEX "LakeAlertRule_pipelineId_idx" ON "LakeAlertRule"("pipelineId");

-- AddForeignKey
ALTER TABLE "LakeAlertRule" ADD CONSTRAINT "LakeAlertRule_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security: tenant isolation by organizationId (matches the GUC set
-- by withOrgTx; the OSS table-owner role is BYPASSRLS so this is install-only
-- there, and enforced for the NOBYPASSRLS vectorflow_app role in multi-tenant).
DO $$
DECLARE
    tbl text;
    tenant_tables text[] := ARRAY['LakeAlertRule'];
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
    RAISE NOTICE 'lake-alerts: RLS installed on LakeAlertRule';
END $$;
