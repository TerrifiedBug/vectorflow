-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "telemetryEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "telemetryEnabledAt" TIMESTAMP(3),
ADD COLUMN     "telemetryInstanceId" TEXT;
