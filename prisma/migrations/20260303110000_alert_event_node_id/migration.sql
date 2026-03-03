-- AlterTable
ALTER TABLE "AlertEvent" ADD COLUMN "nodeId" TEXT;

-- CreateIndex
CREATE INDEX "AlertEvent_nodeId_idx" ON "AlertEvent"("nodeId");

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "VectorNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
