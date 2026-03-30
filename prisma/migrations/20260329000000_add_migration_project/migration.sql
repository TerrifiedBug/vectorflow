-- CreateEnum
CREATE TYPE "MigrationPlatform" AS ENUM ('FLUENTD');

-- CreateEnum
CREATE TYPE "MigrationStatus" AS ENUM ('DRAFT', 'PARSING', 'TRANSLATING', 'VALIDATING', 'READY', 'GENERATING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "MigrationProject" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "MigrationPlatform" NOT NULL,
    "originalConfig" TEXT NOT NULL,
    "parsedTopology" JSONB,
    "pluginInventory" JSONB,
    "readinessScore" INTEGER,
    "readinessReport" JSONB,
    "translatedBlocks" JSONB,
    "validationResult" JSONB,
    "generatedPipelineId" TEXT,
    "status" "MigrationStatus" NOT NULL DEFAULT 'DRAFT',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "MigrationProject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MigrationProject_generatedPipelineId_key" ON "MigrationProject"("generatedPipelineId");

-- CreateIndex
CREATE INDEX "MigrationProject_teamId_idx" ON "MigrationProject"("teamId");

-- CreateIndex
CREATE INDEX "MigrationProject_createdById_idx" ON "MigrationProject"("createdById");

-- AddForeignKey
ALTER TABLE "MigrationProject" ADD CONSTRAINT "MigrationProject_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationProject" ADD CONSTRAINT "MigrationProject_generatedPipelineId_fkey" FOREIGN KEY ("generatedPipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationProject" ADD CONSTRAINT "MigrationProject_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
