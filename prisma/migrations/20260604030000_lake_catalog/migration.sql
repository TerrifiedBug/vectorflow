-- VectorFlow Lake catalog (A1).
--
-- Postgres catalog/metadata for lake datasets; the events themselves live in
-- ClickHouse (lake_events). Two tenant tables with strict RLS (matching
-- 20260521000000); vectorflow_app grants inherited via ALTER DEFAULT PRIVILEGES.

CREATE TABLE "LakeRetentionPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "hotDays" INTEGER NOT NULL DEFAULT 7,
    "coldDays" INTEGER NOT NULL DEFAULT 90,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LakeRetentionPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LakeDataset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT 'default',
    "pipelineId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "schemaJson" JSONB,
    "rowCount" BIGINT NOT NULL DEFAULT 0,
    "byteCount" BIGINT NOT NULL DEFAULT 0,
    "firstEventAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "tiering" TEXT NOT NULL DEFAULT 'hot',
    "retentionPolicyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LakeDataset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LakeRetentionPolicy_organizationId_idx" ON "LakeRetentionPolicy"("organizationId");
CREATE UNIQUE INDEX "LakeRetentionPolicy_organizationId_name_key" ON "LakeRetentionPolicy"("organizationId", "name");
CREATE INDEX "LakeDataset_organizationId_idx" ON "LakeDataset"("organizationId");
CREATE INDEX "LakeDataset_pipelineId_idx" ON "LakeDataset"("pipelineId");
CREATE UNIQUE INDEX "LakeDataset_organizationId_pipelineId_key" ON "LakeDataset"("organizationId", "pipelineId");

ALTER TABLE "LakeDataset" ADD CONSTRAINT "LakeDataset_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LakeDataset" ADD CONSTRAINT "LakeDataset_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LakeDataset" ADD CONSTRAINT "LakeDataset_retentionPolicyId_fkey" FOREIGN KEY ("retentionPolicyId") REFERENCES "LakeRetentionPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
DECLARE
    tbl text;
    tenant_tables text[] := ARRAY['LakeRetentionPolicy', 'LakeDataset'];
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
    RAISE NOTICE 'lake-catalog: RLS installed on LakeRetentionPolicy, LakeDataset';
END $$;
