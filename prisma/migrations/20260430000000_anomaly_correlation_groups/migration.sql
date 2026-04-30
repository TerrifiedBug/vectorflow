-- AlterTable
ALTER TABLE "AnomalyEvent" ADD COLUMN "correlationGroupId" TEXT;

-- CreateIndex
CREATE INDEX "AnomalyEvent_correlationGroupId_idx" ON "AnomalyEvent"("correlationGroupId");

-- AddForeignKey
ALTER TABLE "AnomalyEvent" ADD CONSTRAINT "AnomalyEvent_correlationGroupId_fkey" FOREIGN KEY ("correlationGroupId") REFERENCES "AlertCorrelationGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
