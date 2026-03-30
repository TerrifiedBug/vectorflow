-- Add cost rate column to Environment (cents per GB, default 0 = volume-only mode)
ALTER TABLE "Environment" ADD COLUMN "costPerGbCents" INTEGER NOT NULL DEFAULT 0;

-- Add monthly budget threshold (cents, null = no budget alert)
ALTER TABLE "Environment" ADD COLUMN "costBudgetCents" INTEGER;

-- Add cost_threshold_exceeded to AlertMetric enum
ALTER TYPE "AlertMetric" ADD VALUE IF NOT EXISTS 'cost_threshold_exceeded';
