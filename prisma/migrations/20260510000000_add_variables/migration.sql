-- AlterTable: add variables column to Pipeline
ALTER TABLE "Pipeline" ADD COLUMN "variables" JSONB;

-- AlterTable: add variablesSnapshot column to PipelineVersion
ALTER TABLE "PipelineVersion" ADD COLUMN "variablesSnapshot" JSONB;

-- CreateTable: Variable (environment-scoped key-value pairs)
CREATE TABLE "Variable" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "environmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Variable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Variable_environmentId_idx" ON "Variable"("environmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Variable_environmentId_name_key" ON "Variable"("environmentId", "name");

-- AddForeignKey
ALTER TABLE "Variable" ADD CONSTRAINT "Variable_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
