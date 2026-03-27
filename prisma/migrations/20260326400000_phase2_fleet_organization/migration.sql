-- Phase 2: Fleet Organization
-- Adds NodeGroup model and PipelineGroup parentId self-reference

-- AlterTable: Remove unique constraint on PipelineGroup(environmentId, name)
-- and add parentId self-reference
DROP INDEX "PipelineGroup_environmentId_name_key";

ALTER TABLE "PipelineGroup" ADD COLUMN "parentId" TEXT;

ALTER TABLE "PipelineGroup" ADD CONSTRAINT "PipelineGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PipelineGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex: index on PipelineGroup.parentId
CREATE INDEX "PipelineGroup_parentId_idx" ON "PipelineGroup"("parentId");

-- CreateTable: NodeGroup
CREATE TABLE "NodeGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "labelTemplate" JSONB NOT NULL DEFAULT '{}',
    "requiredLabels" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NodeGroup_environmentId_name_key" ON "NodeGroup"("environmentId", "name");

-- CreateIndex
CREATE INDEX "NodeGroup_environmentId_idx" ON "NodeGroup"("environmentId");

-- AddForeignKey
ALTER TABLE "NodeGroup" ADD CONSTRAINT "NodeGroup_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
