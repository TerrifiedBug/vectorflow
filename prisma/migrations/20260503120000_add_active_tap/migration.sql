-- CreateTable
CREATE TABLE "ActiveTap" (
    "requestId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActiveTap_pkey" PRIMARY KEY ("requestId")
);

-- CreateIndex
CREATE INDEX "ActiveTap_expiresAt_idx" ON "ActiveTap"("expiresAt");

-- CreateIndex
CREATE INDEX "ActiveTap_nodeId_idx" ON "ActiveTap"("nodeId");
