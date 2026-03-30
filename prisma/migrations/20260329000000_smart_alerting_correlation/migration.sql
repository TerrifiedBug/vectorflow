-- AlterTable
ALTER TABLE "AlertRule" ADD COLUMN "cooldownMinutes" INTEGER;

-- CreateTable
CREATE TABLE "AlertCorrelationGroup" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'firing',
    "rootCauseEventId" TEXT,
    "rootCauseSuggestion" TEXT,
    "eventCount" INTEGER NOT NULL DEFAULT 1,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "AlertCorrelationGroup_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "AlertEvent" ADD COLUMN "correlationGroupId" TEXT;

-- CreateIndex
CREATE INDEX "AlertCorrelationGroup_environmentId_status_idx" ON "AlertCorrelationGroup"("environmentId", "status");

-- CreateIndex
CREATE INDEX "AlertCorrelationGroup_openedAt_idx" ON "AlertCorrelationGroup"("openedAt");

-- CreateIndex
CREATE INDEX "AlertEvent_correlationGroupId_idx" ON "AlertEvent"("correlationGroupId");

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_correlationGroupId_fkey" FOREIGN KEY ("correlationGroupId") REFERENCES "AlertCorrelationGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertCorrelationGroup" ADD CONSTRAINT "AlertCorrelationGroup_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
