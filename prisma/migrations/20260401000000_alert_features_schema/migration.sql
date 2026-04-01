-- AlterEnum: Add log_keyword to AlertMetric
ALTER TYPE "AlertMetric" ADD VALUE 'log_keyword';

-- AlterEnum: Add dismissed to AlertStatus
ALTER TYPE "AlertStatus" ADD VALUE 'dismissed';

-- AlterTable: Add errorContext to AlertEvent
ALTER TABLE "AlertEvent" ADD COLUMN "errorContext" JSONB;

-- AlterTable: Add keyword fields to AlertRule
ALTER TABLE "AlertRule" ADD COLUMN "keyword" TEXT,
ADD COLUMN "keywordSeverityFilter" "LogLevel",
ADD COLUMN "keywordWindowMinutes" INTEGER;

-- AlterTable: Add errorContext to AnomalyEvent
ALTER TABLE "AnomalyEvent" ADD COLUMN "errorContext" JSONB;
