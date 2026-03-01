-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "PipelineLog" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,

    CONSTRAINT "PipelineLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineLog_pipelineId_timestamp_idx" ON "PipelineLog"("pipelineId", "timestamp");

-- CreateIndex
CREATE INDEX "PipelineLog_nodeId_timestamp_idx" ON "PipelineLog"("nodeId", "timestamp");

-- CreateIndex
CREATE INDEX "PipelineLog_timestamp_idx" ON "PipelineLog"("timestamp");

-- AddForeignKey
ALTER TABLE "PipelineLog" ADD CONSTRAINT "PipelineLog_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineLog" ADD CONSTRAINT "PipelineLog_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "VectorNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN "logsRetentionDays" INTEGER NOT NULL DEFAULT 3;
