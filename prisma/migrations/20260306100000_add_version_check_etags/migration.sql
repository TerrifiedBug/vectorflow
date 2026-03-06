-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN "latestServerReleaseEtag" TEXT,
ADD COLUMN "latestAgentReleaseEtag" TEXT,
ADD COLUMN "latestDevAgentReleaseEtag" TEXT;
