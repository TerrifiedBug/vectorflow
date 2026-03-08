-- AlterTable
ALTER TABLE "PipelineVersion" ADD COLUMN     "edgesSnapshot" JSONB,
ADD COLUMN     "nodesSnapshot" JSONB;
