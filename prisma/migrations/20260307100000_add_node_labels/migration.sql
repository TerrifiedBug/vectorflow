-- AlterTable
ALTER TABLE "VectorNode" ADD COLUMN "labels" JSONB DEFAULT '{}';

-- AlterTable
ALTER TABLE "Pipeline" ADD COLUMN "nodeSelector" JSONB;
