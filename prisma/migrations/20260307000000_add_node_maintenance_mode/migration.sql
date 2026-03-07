-- AlterTable
ALTER TABLE "VectorNode" ADD COLUMN "maintenanceMode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "VectorNode" ADD COLUMN "maintenanceModeAt" TIMESTAMP(3);
