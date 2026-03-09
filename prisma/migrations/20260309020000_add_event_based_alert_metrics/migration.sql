-- Add new event-based values to AlertMetric enum
ALTER TYPE "AlertMetric" ADD VALUE 'deploy_requested';
ALTER TYPE "AlertMetric" ADD VALUE 'deploy_completed';
ALTER TYPE "AlertMetric" ADD VALUE 'deploy_rejected';
ALTER TYPE "AlertMetric" ADD VALUE 'deploy_cancelled';
ALTER TYPE "AlertMetric" ADD VALUE 'new_version_available';
ALTER TYPE "AlertMetric" ADD VALUE 'scim_sync_failed';
ALTER TYPE "AlertMetric" ADD VALUE 'backup_failed';
ALTER TYPE "AlertMetric" ADD VALUE 'certificate_expiring';
ALTER TYPE "AlertMetric" ADD VALUE 'node_joined';
ALTER TYPE "AlertMetric" ADD VALUE 'node_left';

-- Make threshold fields nullable for event-based rules
ALTER TABLE "AlertRule" ALTER COLUMN "condition" DROP NOT NULL;
ALTER TABLE "AlertRule" ALTER COLUMN "threshold" DROP NOT NULL;
ALTER TABLE "AlertRule" ALTER COLUMN "durationSeconds" DROP NOT NULL;
ALTER TABLE "AlertRule" ALTER COLUMN "durationSeconds" DROP DEFAULT;
