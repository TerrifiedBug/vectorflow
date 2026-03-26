-- CreateTable
CREATE TABLE "StagedRollout" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "canaryVersionId" TEXT NOT NULL,
    "previousVersionId" TEXT,
    "canarySelector" JSONB NOT NULL,
    "originalSelector" JSONB,
    "canaryNodeIds" JSONB NOT NULL,
    "remainingNodeIds" JSONB,
    "status" TEXT NOT NULL DEFAULT 'CANARY_DEPLOYED',
    "healthCheckWindowMinutes" INTEGER NOT NULL DEFAULT 5,
    "healthCheckExpiresAt" TIMESTAMP(3),
    "broadenedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StagedRollout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StagedRollout_pipelineId_status_idx" ON "StagedRollout"("pipelineId", "status");

-- CreateIndex
CREATE INDEX "StagedRollout_status_healthCheckExpiresAt_idx" ON "StagedRollout"("status", "healthCheckExpiresAt");

-- AddForeignKey
ALTER TABLE "StagedRollout" ADD CONSTRAINT "StagedRollout_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedRollout" ADD CONSTRAINT "StagedRollout_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedRollout" ADD CONSTRAINT "StagedRollout_canaryVersionId_fkey" FOREIGN KEY ("canaryVersionId") REFERENCES "PipelineVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedRollout" ADD CONSTRAINT "StagedRollout_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "PipelineVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedRollout" ADD CONSTRAINT "StagedRollout_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
