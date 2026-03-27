-- CreateTable
CREATE TABLE "PromotionRequest" (
    "id" TEXT NOT NULL,
    "sourcePipelineId" TEXT NOT NULL,
    "targetPipelineId" TEXT,
    "sourceEnvironmentId" TEXT NOT NULL,
    "targetEnvironmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "promotedById" TEXT,
    "approvedById" TEXT,
    "nodesSnapshot" JSONB,
    "edgesSnapshot" JSONB,
    "globalConfigSnapshot" JSONB,
    "targetPipelineName" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "deployedAt" TIMESTAMP(3),

    CONSTRAINT "PromotionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromotionRequest_sourcePipelineId_status_idx" ON "PromotionRequest"("sourcePipelineId", "status");

-- CreateIndex
CREATE INDEX "PromotionRequest_sourceEnvironmentId_idx" ON "PromotionRequest"("sourceEnvironmentId");

-- CreateIndex
CREATE INDEX "PromotionRequest_targetEnvironmentId_idx" ON "PromotionRequest"("targetEnvironmentId");

-- AddForeignKey
ALTER TABLE "PromotionRequest" ADD CONSTRAINT "PromotionRequest_sourcePipelineId_fkey" FOREIGN KEY ("sourcePipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRequest" ADD CONSTRAINT "PromotionRequest_targetPipelineId_fkey" FOREIGN KEY ("targetPipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRequest" ADD CONSTRAINT "PromotionRequest_sourceEnvironmentId_fkey" FOREIGN KEY ("sourceEnvironmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRequest" ADD CONSTRAINT "PromotionRequest_targetEnvironmentId_fkey" FOREIGN KEY ("targetEnvironmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRequest" ADD CONSTRAINT "PromotionRequest_promotedById_fkey" FOREIGN KEY ("promotedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRequest" ADD CONSTRAINT "PromotionRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
