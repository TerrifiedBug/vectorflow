-- Release unification (clean cutover).
--
-- Subsumes DeployRequest (DIRECT), PromotionRequest (PROMOTION) and
-- StagedRollout (CANARY) into a single `Release` table discriminated by
-- `strategy`. Existing rows are migrated 1:1 (ids preserved so AuditLog
-- entityId linkage to the old request/rollout rows survives), then the three
-- legacy tables are dropped in the same migration.
--
-- Ordering is deliberate: create the new table + FKs, copy the data while the
-- legacy tables still exist, then drop them. RLS is enabled last (matching the
-- strict per-table policy shape from 20260516000001 / 20260521000000). New
-- tables created by the migrating owner inherit vectorflow_app grants via the
-- ALTER DEFAULT PRIVILEGES installed in 20260516000006, so no explicit GRANT
-- is required here.

-- ─── 1. Enum + table ────────────────────────────────────────────────────────
CREATE TYPE "ReleaseStrategy" AS ENUM ('DIRECT', 'PROMOTION', 'CANARY');

CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT 'default',
    "strategy" "ReleaseStrategy" NOT NULL,
    "status" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "changelog" TEXT NOT NULL DEFAULT '',
    "reviewNote" TEXT,
    "requestedById" TEXT,
    "reviewedById" TEXT,
    "deployedById" TEXT,
    "configYaml" TEXT,
    "nodeSelector" JSONB,
    "targetPipelineId" TEXT,
    "targetEnvironmentId" TEXT,
    "targetPipelineName" TEXT,
    "nodesSnapshot" JSONB,
    "edgesSnapshot" JSONB,
    "globalConfigSnapshot" JSONB,
    "prUrl" TEXT,
    "prNumber" INTEGER,
    "canaryVersionId" TEXT,
    "previousVersionId" TEXT,
    "canarySelector" JSONB,
    "originalSelector" JSONB,
    "canaryNodeIds" JSONB,
    "remainingNodeIds" JSONB,
    "healthCheckWindowMinutes" INTEGER,
    "healthCheckExpiresAt" TIMESTAMP(3),
    "broadenedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "deployedAt" TIMESTAMP(3),

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Release_organizationId_idx" ON "Release"("organizationId");
CREATE INDEX "Release_pipelineId_strategy_status_idx" ON "Release"("pipelineId", "strategy", "status");
CREATE INDEX "Release_environmentId_status_idx" ON "Release"("environmentId", "status");
CREATE INDEX "Release_targetEnvironmentId_idx" ON "Release"("targetEnvironmentId");
CREATE INDEX "Release_status_healthCheckExpiresAt_idx" ON "Release"("status", "healthCheckExpiresAt");

ALTER TABLE "Release" ADD CONSTRAINT "Release_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Release" ADD CONSTRAINT "Release_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Release" ADD CONSTRAINT "Release_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Release" ADD CONSTRAINT "Release_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Release" ADD CONSTRAINT "Release_deployedById_fkey" FOREIGN KEY ("deployedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Release" ADD CONSTRAINT "Release_targetPipelineId_fkey" FOREIGN KEY ("targetPipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Release" ADD CONSTRAINT "Release_targetEnvironmentId_fkey" FOREIGN KEY ("targetEnvironmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Release" ADD CONSTRAINT "Release_canaryVersionId_fkey" FOREIGN KEY ("canaryVersionId") REFERENCES "PipelineVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Release" ADD CONSTRAINT "Release_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "PipelineVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── 2. Data migration (legacy tables still present) ─────────────────────────

-- DeployRequest → Release (DIRECT). updatedAt did not exist on DeployRequest;
-- seed it from createdAt.
INSERT INTO "Release" (
    "id", "organizationId", "strategy", "status", "pipelineId", "environmentId",
    "changelog", "reviewNote", "requestedById", "reviewedById", "deployedById",
    "configYaml", "nodeSelector",
    "createdAt", "updatedAt", "reviewedAt", "deployedAt"
)
SELECT
    "id", "organizationId", 'DIRECT'::"ReleaseStrategy", "status", "pipelineId", "environmentId",
    "changelog", "reviewNote", "requestedById", "reviewedById", "deployedById",
    "configYaml", "nodeSelector",
    "createdAt", "createdAt", "reviewedAt", "deployedAt"
FROM "DeployRequest";

-- PromotionRequest → Release (PROMOTION). sourcePipeline/sourceEnvironment map
-- to the primary pipeline/environment; promotedBy→requestedBy, approvedBy→
-- reviewedBy. No changelog column existed; default to ''.
INSERT INTO "Release" (
    "id", "organizationId", "strategy", "status", "pipelineId", "environmentId",
    "targetPipelineId", "targetEnvironmentId", "targetPipelineName",
    "requestedById", "reviewedById", "reviewNote",
    "nodesSnapshot", "edgesSnapshot", "globalConfigSnapshot", "prUrl", "prNumber",
    "changelog", "createdAt", "updatedAt", "reviewedAt", "deployedAt"
)
SELECT
    "id", "organizationId", 'PROMOTION'::"ReleaseStrategy", "status", "sourcePipelineId", "sourceEnvironmentId",
    "targetPipelineId", "targetEnvironmentId", "targetPipelineName",
    "promotedById", "approvedById", "reviewNote",
    "nodesSnapshot", "edgesSnapshot", "globalConfigSnapshot", "prUrl", "prNumber",
    '', "createdAt", "createdAt", "reviewedAt", "deployedAt"
FROM "PromotionRequest";

-- StagedRollout → Release (CANARY). createdBy→requestedBy. No changelog column;
-- default to ''.
INSERT INTO "Release" (
    "id", "organizationId", "strategy", "status", "pipelineId", "environmentId",
    "canaryVersionId", "previousVersionId", "canarySelector", "originalSelector",
    "canaryNodeIds", "remainingNodeIds", "healthCheckWindowMinutes", "healthCheckExpiresAt",
    "broadenedAt", "rolledBackAt", "requestedById",
    "changelog", "createdAt", "updatedAt"
)
SELECT
    "id", "organizationId", 'CANARY'::"ReleaseStrategy", "status", "pipelineId", "environmentId",
    "canaryVersionId", "previousVersionId", "canarySelector", "originalSelector",
    "canaryNodeIds", "remainingNodeIds", "healthCheckWindowMinutes", "healthCheckExpiresAt",
    "broadenedAt", "rolledBackAt", "createdById",
    '', "createdAt", "updatedAt"
FROM "StagedRollout";

-- ─── 3. Drop legacy tables ───────────────────────────────────────────────────
ALTER TABLE "StagedRollout" DROP CONSTRAINT "StagedRollout_pipelineId_fkey";
ALTER TABLE "StagedRollout" DROP CONSTRAINT "StagedRollout_environmentId_fkey";
ALTER TABLE "StagedRollout" DROP CONSTRAINT "StagedRollout_canaryVersionId_fkey";
ALTER TABLE "StagedRollout" DROP CONSTRAINT "StagedRollout_previousVersionId_fkey";
ALTER TABLE "StagedRollout" DROP CONSTRAINT "StagedRollout_createdById_fkey";
ALTER TABLE "DeployRequest" DROP CONSTRAINT "DeployRequest_pipelineId_fkey";
ALTER TABLE "DeployRequest" DROP CONSTRAINT "DeployRequest_environmentId_fkey";
ALTER TABLE "DeployRequest" DROP CONSTRAINT "DeployRequest_requestedById_fkey";
ALTER TABLE "DeployRequest" DROP CONSTRAINT "DeployRequest_reviewedById_fkey";
ALTER TABLE "DeployRequest" DROP CONSTRAINT "DeployRequest_deployedById_fkey";
ALTER TABLE "PromotionRequest" DROP CONSTRAINT "PromotionRequest_sourcePipelineId_fkey";
ALTER TABLE "PromotionRequest" DROP CONSTRAINT "PromotionRequest_targetPipelineId_fkey";
ALTER TABLE "PromotionRequest" DROP CONSTRAINT "PromotionRequest_sourceEnvironmentId_fkey";
ALTER TABLE "PromotionRequest" DROP CONSTRAINT "PromotionRequest_targetEnvironmentId_fkey";
ALTER TABLE "PromotionRequest" DROP CONSTRAINT "PromotionRequest_promotedById_fkey";
ALTER TABLE "PromotionRequest" DROP CONSTRAINT "PromotionRequest_approvedById_fkey";

DROP TABLE "StagedRollout";
DROP TABLE "DeployRequest";
DROP TABLE "PromotionRequest";

-- ─── 4. Row-level security (strict per-table policy) ─────────────────────────
DO $$
BEGIN
    EXECUTE 'ALTER TABLE "Release" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Release_org_isolation" ON "Release"';
    EXECUTE $p$
        CREATE POLICY "Release_org_isolation" ON "Release"
        USING ("organizationId" = current_setting('app.org_id', true))
        WITH CHECK ("organizationId" = current_setting('app.org_id', true));
    $p$;
    RAISE NOTICE 'release-unification: RLS policy installed on Release';
END $$;
