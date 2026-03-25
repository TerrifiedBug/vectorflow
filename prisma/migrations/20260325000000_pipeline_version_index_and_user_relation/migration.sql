-- AlterTable: make createdById nullable (required for SetNull on delete)
ALTER TABLE "PipelineVersion" ALTER COLUMN "createdById" DROP NOT NULL;

-- CreateIndex: composite index for version history queries
CREATE INDEX "PipelineVersion_pipelineId_version_idx" ON "PipelineVersion"("pipelineId", "version");

-- AddForeignKey: link PipelineVersion.createdById → User.id
ALTER TABLE "PipelineVersion" ADD CONSTRAINT "PipelineVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
