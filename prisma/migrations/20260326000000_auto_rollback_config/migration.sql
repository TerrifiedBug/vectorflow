-- AlterTable: add auto-rollback configuration fields to Pipeline
ALTER TABLE "Pipeline" ADD COLUMN "autoRollbackEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "autoRollbackThreshold" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
ADD COLUMN "autoRollbackWindowMinutes" INTEGER NOT NULL DEFAULT 5;
