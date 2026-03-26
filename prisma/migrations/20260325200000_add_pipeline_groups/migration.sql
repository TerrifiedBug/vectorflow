-- CreateTable
CREATE TABLE "PipelineGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "environmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineGroup_environmentId_idx" ON "PipelineGroup"("environmentId");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineGroup_environmentId_name_key" ON "PipelineGroup"("environmentId", "name");

-- AddForeignKey
ALTER TABLE "PipelineGroup" ADD CONSTRAINT "PipelineGroup_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Pipeline" ADD COLUMN "groupId" TEXT;

-- AddForeignKey
ALTER TABLE "Pipeline" ADD CONSTRAINT "Pipeline_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PipelineGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
