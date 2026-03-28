-- AlterTable
ALTER TABLE "Environment" ADD COLUMN "gitProvider" TEXT;

-- AlterTable
ALTER TABLE "Pipeline" ADD COLUMN "gitPath" TEXT;

-- AlterEnum
ALTER TYPE "AlertMetric" ADD VALUE 'git_sync_failed';

-- CreateTable
CREATE TABLE "GitSyncJob" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "configYaml" TEXT,
    "commitMessage" TEXT,
    "authorName" TEXT,
    "authorEmail" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GitSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GitSyncJob_status_nextRetryAt_idx" ON "GitSyncJob"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "GitSyncJob_environmentId_idx" ON "GitSyncJob"("environmentId");

-- CreateIndex
CREATE INDEX "GitSyncJob_pipelineId_idx" ON "GitSyncJob"("pipelineId");

-- AddForeignKey
ALTER TABLE "GitSyncJob" ADD CONSTRAINT "GitSyncJob_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitSyncJob" ADD CONSTRAINT "GitSyncJob_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
