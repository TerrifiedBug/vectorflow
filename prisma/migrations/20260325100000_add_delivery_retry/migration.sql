-- AlterTable: add retry fields to DeliveryAttempt
ALTER TABLE "DeliveryAttempt" ADD COLUMN "attemptNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "nextRetryAt" TIMESTAMP(3),
ADD COLUMN "webhookId" TEXT,
ADD COLUMN "channelId" TEXT;

-- CreateIndex: composite index for retry poll query
CREATE INDEX "DeliveryAttempt_status_nextRetryAt_idx" ON "DeliveryAttempt"("status", "nextRetryAt");
