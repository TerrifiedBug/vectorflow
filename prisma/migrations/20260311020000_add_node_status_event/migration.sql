-- CreateTable
CREATE TABLE "NodeStatusEvent" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodeStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NodeStatusEvent_nodeId_timestamp_idx" ON "NodeStatusEvent"("nodeId", "timestamp");

-- CreateIndex
CREATE INDEX "NodeStatusEvent_timestamp_idx" ON "NodeStatusEvent"("timestamp");

-- AddForeignKey
ALTER TABLE "NodeStatusEvent" ADD CONSTRAINT "NodeStatusEvent_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "VectorNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
