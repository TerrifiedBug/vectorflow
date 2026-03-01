-- CreateEnum
CREATE TYPE "DeployMode" AS ENUM ('GITOPS', 'AGENT');

-- CreateEnum
CREATE TYPE "SecretBackend" AS ENUM ('BUILTIN', 'VAULT', 'AWS_SM', 'EXEC');

-- CreateEnum
CREATE TYPE "ProcessStatus" AS ENUM ('RUNNING', 'STARTING', 'STOPPED', 'CRASHED', 'PENDING');

-- AlterTable: Environment
ALTER TABLE "Environment" ADD COLUMN "deployMode" "DeployMode" NOT NULL DEFAULT 'GITOPS';
ALTER TABLE "Environment" ADD COLUMN "enrollmentTokenHash" TEXT;
ALTER TABLE "Environment" ADD COLUMN "enrollmentTokenHint" TEXT;
ALTER TABLE "Environment" ADD COLUMN "secretBackend" "SecretBackend" NOT NULL DEFAULT 'BUILTIN';
ALTER TABLE "Environment" ADD COLUMN "secretBackendConfig" JSONB;

-- AlterTable: VectorNode
ALTER TABLE "VectorNode" ADD COLUMN "nodeTokenHash" TEXT;
ALTER TABLE "VectorNode" ADD COLUMN "enrolledAt" TIMESTAMP(3);
ALTER TABLE "VectorNode" ADD COLUMN "lastHeartbeat" TIMESTAMP(3);
ALTER TABLE "VectorNode" ADD COLUMN "agentVersion" TEXT;
ALTER TABLE "VectorNode" ADD COLUMN "vectorVersion" TEXT;
ALTER TABLE "VectorNode" ADD COLUMN "os" TEXT;

-- AlterTable: SystemSettings
ALTER TABLE "SystemSettings" ADD COLUMN "metricsRetentionDays" INTEGER NOT NULL DEFAULT 7;

-- CreateTable
CREATE TABLE "NodePipelineStatus" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ProcessStatus" NOT NULL DEFAULT 'PENDING',
    "pid" INTEGER,
    "uptimeSeconds" INTEGER,
    "eventsIn" BIGINT NOT NULL DEFAULT 0,
    "eventsOut" BIGINT NOT NULL DEFAULT 0,
    "errorsTotal" BIGINT NOT NULL DEFAULT 0,
    "bytesIn" BIGINT NOT NULL DEFAULT 0,
    "bytesOut" BIGINT NOT NULL DEFAULT 0,
    "utilization" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodePipelineStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineMetric" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "nodeId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "eventsIn" BIGINT NOT NULL DEFAULT 0,
    "eventsOut" BIGINT NOT NULL DEFAULT 0,
    "eventsDiscarded" BIGINT NOT NULL DEFAULT 0,
    "errorsTotal" BIGINT NOT NULL DEFAULT 0,
    "bytesIn" BIGINT NOT NULL DEFAULT 0,
    "bytesOut" BIGINT NOT NULL DEFAULT 0,
    "utilization" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "PipelineMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NodePipelineStatus_nodeId_pipelineId_key" ON "NodePipelineStatus"("nodeId", "pipelineId");

-- CreateIndex
CREATE INDEX "PipelineMetric_pipelineId_timestamp_idx" ON "PipelineMetric"("pipelineId", "timestamp");

-- CreateIndex
CREATE INDEX "PipelineMetric_timestamp_idx" ON "PipelineMetric"("timestamp");

-- AddForeignKey
ALTER TABLE "NodePipelineStatus" ADD CONSTRAINT "NodePipelineStatus_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "VectorNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodePipelineStatus" ADD CONSTRAINT "NodePipelineStatus_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineMetric" ADD CONSTRAINT "PipelineMetric_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
