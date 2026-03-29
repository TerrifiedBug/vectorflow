-- AlterEnum
ALTER TYPE "AlertMetric" ADD VALUE 'version_drift';
ALTER TYPE "AlertMetric" ADD VALUE 'config_drift';

-- AlterTable
ALTER TABLE "NodePipelineStatus" ADD COLUMN "configChecksum" TEXT;
