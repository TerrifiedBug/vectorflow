-- AlterTable
ALTER TABLE "Pipeline" ADD COLUMN "tags" JSONB DEFAULT '[]';

-- AlterTable
ALTER TABLE "Team" ADD COLUMN "availableTags" JSONB DEFAULT '[]';
