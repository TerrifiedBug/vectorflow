-- Agentic AI proposed-change staging (B2).
--
-- A human-approval-gated record for AI-generated pipeline-graph / VRL edits.
-- Tenant table with strict RLS (matching 20260521000000); vectorflow_app grants
-- are inherited via ALTER DEFAULT PRIVILEGES (20260516000006).

CREATE TYPE "ProposedChangeKind" AS ENUM ('PIPELINE_GRAPH', 'VRL');
CREATE TYPE "ProposedChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'APPLIED');

CREATE TABLE "ProposedChange" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT 'default',
    "pipelineId" TEXT NOT NULL,
    "kind" "ProposedChangeKind" NOT NULL,
    "status" "ProposedChangeStatus" NOT NULL DEFAULT 'PENDING',
    "summary" TEXT NOT NULL,
    "prompt" TEXT,
    "proposedNodes" JSONB,
    "proposedEdges" JSONB,
    "proposedGlobalConfig" JSONB,
    "vrlSource" TEXT,
    "targetComponentKey" TEXT,
    "validationResult" JSONB,
    "validated" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    CONSTRAINT "ProposedChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProposedChange_organizationId_idx" ON "ProposedChange"("organizationId");
CREATE INDEX "ProposedChange_pipelineId_status_idx" ON "ProposedChange"("pipelineId", "status");

ALTER TABLE "ProposedChange" ADD CONSTRAINT "ProposedChange_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProposedChange" ADD CONSTRAINT "ProposedChange_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProposedChange" ADD CONSTRAINT "ProposedChange_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
BEGIN
    EXECUTE 'ALTER TABLE "ProposedChange" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "ProposedChange_org_isolation" ON "ProposedChange"';
    EXECUTE $p$
        CREATE POLICY "ProposedChange_org_isolation" ON "ProposedChange"
        USING ("organizationId" = current_setting('app.org_id', true))
        WITH CHECK ("organizationId" = current_setting('app.org_id', true));
    $p$;
    RAISE NOTICE 'proposed-change: RLS policy installed on ProposedChange';
END $$;
