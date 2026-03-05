-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN "latestAgentChecksums" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "latestDevAgentRelease" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "latestDevAgentReleaseCheckedAt" TIMESTAMP(3);
ALTER TABLE "SystemSettings" ADD COLUMN "latestDevAgentChecksums" TEXT;
