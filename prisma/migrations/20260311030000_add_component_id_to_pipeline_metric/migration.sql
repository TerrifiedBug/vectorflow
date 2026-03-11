-- AlterTable: Add componentId column to PipelineMetric for per-component latency
ALTER TABLE "PipelineMetric" ADD COLUMN "componentId" TEXT;

-- CreateIndex: Compound index for per-component latency queries
CREATE INDEX "PipelineMetric_pipelineId_componentId_timestamp_idx" ON "PipelineMetric"("pipelineId", "componentId", "timestamp");
