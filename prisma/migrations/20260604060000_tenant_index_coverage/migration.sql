-- Tenant index coverage: upgrade the single-column `(organizationId)` indexes on
-- the new tenant tables to composite indexes LEADING on organizationId. Without a
-- leading-organizationId composite, Postgres falls back to a Seq Scan for the RLS
-- predicate (organizationId = current_setting('app.org_id', true)) and the per-org
-- p95 SLO cannot be held (enforced by scripts/verify-indexes.sh). The composite
-- also subsumes the dropped single-column index for org-only lookups.

-- Release (was DeployRequest/PromotionRequest/StagedRollout): discriminated list
-- queries filter organizationId + strategy + status.
DROP INDEX "Release_organizationId_idx";
CREATE INDEX "Release_organizationId_strategy_status_idx" ON "Release"("organizationId", "strategy", "status");

-- ProposedChange: review queue listed by organizationId + status.
DROP INDEX "ProposedChange_organizationId_idx";
CREATE INDEX "ProposedChange_organizationId_status_idx" ON "ProposedChange"("organizationId", "status");

-- ReplayJob: jobs listed by organizationId + status.
DROP INDEX "ReplayJob_organizationId_idx";
CREATE INDEX "ReplayJob_organizationId_status_idx" ON "ReplayJob"("organizationId", "status");

-- TapCapture: captures listed per organizationId + pipeline.
DROP INDEX "TapCapture_organizationId_idx";
CREATE INDEX "TapCapture_organizationId_pipelineId_idx" ON "TapCapture"("organizationId", "pipelineId");

-- NodeMetricRollup: long-range rollup reads scan organizationId + bucketStart.
DROP INDEX "NodeMetricRollup_organizationId_idx";
CREATE INDEX "NodeMetricRollup_organizationId_bucketStart_idx" ON "NodeMetricRollup"("organizationId", "bucketStart");

-- PipelineMetricRollup: long-range rollup reads scan organizationId + bucketStart.
DROP INDEX "PipelineMetricRollup_organizationId_idx";
CREATE INDEX "PipelineMetricRollup_organizationId_bucketStart_idx" ON "PipelineMetricRollup"("organizationId", "bucketStart");

-- EnvironmentLakeBucket: looked up by organizationId + environmentId.
DROP INDEX "EnvironmentLakeBucket_organizationId_idx";
CREATE INDEX "EnvironmentLakeBucket_organizationId_environmentId_idx" ON "EnvironmentLakeBucket"("organizationId", "environmentId");
