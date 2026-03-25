-- AlterEnum: add 'acknowledged' to AlertStatus
ALTER TYPE "AlertStatus" ADD VALUE 'acknowledged';

-- AlterTable: add snoozedUntil to AlertRule
ALTER TABLE "AlertRule" ADD COLUMN "snoozedUntil" TIMESTAMP(3);

-- AlterTable: add acknowledgedAt, acknowledgedBy to AlertEvent
ALTER TABLE "AlertEvent" ADD COLUMN "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN "acknowledgedBy" TEXT;

-- CreateTable: DeliveryAttempt
CREATE TABLE "DeliveryAttempt" (
    "id" TEXT NOT NULL,
    "alertEventId" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "statusCode" INTEGER,
    "errorMessage" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryAttempt_alertEventId_idx" ON "DeliveryAttempt"("alertEventId");

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_alertEventId_fkey" FOREIGN KEY ("alertEventId") REFERENCES "AlertEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
