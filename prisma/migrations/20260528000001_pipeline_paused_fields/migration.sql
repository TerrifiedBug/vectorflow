-- AlterTable: add pausedAt and pausedBy to Pipeline for operator pause-runaway-pipeline (OC4)
ALTER TABLE "Pipeline" ADD COLUMN "pausedAt" TIMESTAMP(3),
                       ADD COLUMN "pausedBy" TEXT;
