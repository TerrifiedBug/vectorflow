-- AlterTable: make createdById nullable (required for SetNull on delete)
ALTER TABLE "PipelineVersion" ALTER COLUMN "createdById" DROP NOT NULL;

-- CreateIndex: composite index already created by 20260325000000_add_pipeline_performance_indexes
-- Skipped: CREATE INDEX "PipelineVersion_pipelineId_version_idx" (duplicate)

-- AddForeignKey: link PipelineVersion.createdById → User.id
ALTER TABLE "PipelineVersion" ADD CONSTRAINT "PipelineVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
