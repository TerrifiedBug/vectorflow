-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN "anomalyBaselineWindowDays" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "SystemSettings" ADD COLUMN "anomalySigmaThreshold" DOUBLE PRECISION NOT NULL DEFAULT 3;
ALTER TABLE "SystemSettings" ADD COLUMN "anomalyMinStddevFloorPercent" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "SystemSettings" ADD COLUMN "anomalyDedupWindowHours" INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "SystemSettings" ADD COLUMN "anomalyEnabledMetrics" TEXT NOT NULL DEFAULT 'eventsIn,errorsTotal,latencyMeanMs';
