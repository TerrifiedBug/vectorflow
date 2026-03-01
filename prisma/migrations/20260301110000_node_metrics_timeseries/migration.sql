-- CreateTable
CREATE TABLE "NodeMetric" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "memoryTotalBytes" BIGINT NOT NULL DEFAULT 0,
    "memoryUsedBytes" BIGINT NOT NULL DEFAULT 0,
    "memoryFreeBytes" BIGINT NOT NULL DEFAULT 0,
    "cpuSecondsTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "loadAvg1" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "loadAvg5" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "loadAvg15" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fsTotalBytes" BIGINT NOT NULL DEFAULT 0,
    "fsUsedBytes" BIGINT NOT NULL DEFAULT 0,
    "fsFreeBytes" BIGINT NOT NULL DEFAULT 0,
    "diskReadBytes" BIGINT NOT NULL DEFAULT 0,
    "diskWrittenBytes" BIGINT NOT NULL DEFAULT 0,
    "netRxBytes" BIGINT NOT NULL DEFAULT 0,
    "netTxBytes" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "NodeMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NodeMetric_nodeId_timestamp_idx" ON "NodeMetric"("nodeId", "timestamp");

-- CreateIndex
CREATE INDEX "NodeMetric_timestamp_idx" ON "NodeMetric"("timestamp");

-- AddForeignKey
ALTER TABLE "NodeMetric" ADD CONSTRAINT "NodeMetric_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "VectorNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
