-- CreateEnum
CREATE TYPE "DeploymentMode" AS ENUM ('STANDALONE', 'DOCKER', 'UNKNOWN');

-- AlterTable: VectorNode
ALTER TABLE "VectorNode" ADD COLUMN "deploymentMode" "DeploymentMode" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "VectorNode" ADD COLUMN "pendingAction" JSONB;

-- AlterTable: Pipeline
ALTER TABLE "Pipeline" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: SystemSettings
ALTER TABLE "SystemSettings" ADD COLUMN "latestServerRelease" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "latestServerReleaseCheckedAt" TIMESTAMP(3);
ALTER TABLE "SystemSettings" ADD COLUMN "latestAgentRelease" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "latestAgentReleaseCheckedAt" TIMESTAMP(3);
