-- Lake replay/rehydration jobs (A4).
--
-- Tenant table with strict RLS (matching 20260521000000); vectorflow_app grants
-- inherited via ALTER DEFAULT PRIVILEGES (20260516000006).

CREATE TABLE "ReplayJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT 'default',
    "sourcePipelineId" TEXT NOT NULL,
    "targetPipelineId" TEXT NOT NULL,
    "fromTime" TIMESTAMP(3) NOT NULL,
    "toTime" TIMESTAMP(3) NOT NULL,
    "filter" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "totalEvents" BIGINT NOT NULL DEFAULT 0,
    "replayedEvents" BIGINT NOT NULL DEFAULT 0,
    "dedupeKey" TEXT NOT NULL,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "ReplayJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReplayJob_organizationId_idx" ON "ReplayJob"("organizationId");
CREATE INDEX "ReplayJob_targetPipelineId_status_idx" ON "ReplayJob"("targetPipelineId", "status");
CREATE INDEX "ReplayJob_status_idx" ON "ReplayJob"("status");

ALTER TABLE "ReplayJob" ADD CONSTRAINT "ReplayJob_sourcePipelineId_fkey" FOREIGN KEY ("sourcePipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReplayJob" ADD CONSTRAINT "ReplayJob_targetPipelineId_fkey" FOREIGN KEY ("targetPipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReplayJob" ADD CONSTRAINT "ReplayJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
BEGIN
    EXECUTE 'ALTER TABLE "ReplayJob" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "ReplayJob_org_isolation" ON "ReplayJob"';
    EXECUTE $p$
        CREATE POLICY "ReplayJob_org_isolation" ON "ReplayJob"
        USING ("organizationId" = current_setting('app.org_id', true))
        WITH CHECK ("organizationId" = current_setting('app.org_id', true));
    $p$;
    RAISE NOTICE 'replay-job: RLS policy installed on ReplayJob';
END $$;
