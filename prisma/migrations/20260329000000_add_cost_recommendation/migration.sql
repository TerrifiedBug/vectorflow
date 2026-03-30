-- CreateEnum
CREATE TYPE "RecommendationType" AS ENUM ('LOW_REDUCTION', 'HIGH_ERROR_RATE', 'DUPLICATE_SINK', 'STALE_PIPELINE');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('PENDING', 'DISMISSED', 'APPLIED');

-- CreateTable
CREATE TABLE "CostRecommendation" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "type" "RecommendationType" NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "aiSummary" TEXT,
    "suggestedAction" JSONB,
    "analysisData" JSONB NOT NULL,
    "estimatedSavingsBytes" BIGINT,
    "dismissedById" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostRecommendation_teamId_status_idx" ON "CostRecommendation"("teamId", "status");

-- CreateIndex
CREATE INDEX "CostRecommendation_pipelineId_idx" ON "CostRecommendation"("pipelineId");

-- CreateIndex
CREATE INDEX "CostRecommendation_environmentId_status_idx" ON "CostRecommendation"("environmentId", "status");

-- CreateIndex
CREATE INDEX "CostRecommendation_expiresAt_idx" ON "CostRecommendation"("expiresAt");

-- AddForeignKey
ALTER TABLE "CostRecommendation" ADD CONSTRAINT "CostRecommendation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostRecommendation" ADD CONSTRAINT "CostRecommendation_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostRecommendation" ADD CONSTRAINT "CostRecommendation_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostRecommendation" ADD CONSTRAINT "CostRecommendation_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
