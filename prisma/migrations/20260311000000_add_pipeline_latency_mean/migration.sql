-- AlterTable: Add latencyMeanMs column to PipelineMetric
ALTER TABLE "PipelineMetric" ADD COLUMN "latencyMeanMs" DOUBLE PRECISION;
