-- CreateEnum
CREATE TYPE "AnomalyType" AS ENUM ('throughput_drop', 'throughput_spike', 'error_rate_spike', 'latency_spike');

-- CreateEnum
CREATE TYPE "AnomalySeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateTable
CREATE TABLE "AnomalyEvent" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "anomalyType" "AnomalyType" NOT NULL,
    "severity" "AnomalySeverity" NOT NULL,
    "metricName" TEXT NOT NULL,
    "currentValue" DOUBLE PRECISION NOT NULL,
    "baselineMean" DOUBLE PRECISION NOT NULL,
    "baselineStddev" DOUBLE PRECISION NOT NULL,
    "deviationFactor" DOUBLE PRECISION NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "dismissedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnomalyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnomalyEvent_pipelineId_idx" ON "AnomalyEvent"("pipelineId");

-- CreateIndex
CREATE INDEX "AnomalyEvent_environmentId_idx" ON "AnomalyEvent"("environmentId");

-- CreateIndex
CREATE INDEX "AnomalyEvent_teamId_idx" ON "AnomalyEvent"("teamId");

-- CreateIndex
CREATE INDEX "AnomalyEvent_status_idx" ON "AnomalyEvent"("status");

-- CreateIndex
CREATE INDEX "AnomalyEvent_detectedAt_idx" ON "AnomalyEvent"("detectedAt");

-- AddForeignKey
ALTER TABLE "AnomalyEvent" ADD CONSTRAINT "AnomalyEvent_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnomalyEvent" ADD CONSTRAINT "AnomalyEvent_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnomalyEvent" ADD CONSTRAINT "AnomalyEvent_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
