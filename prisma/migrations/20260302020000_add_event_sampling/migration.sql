-- CreateTable
CREATE TABLE "EventSampleRequest" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "componentKeys" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "nodeId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "EventSampleRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventSample" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "componentKey" TEXT NOT NULL,
    "events" JSONB NOT NULL,
    "schema" JSONB NOT NULL,
    "error" TEXT,
    "sampledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventSample_pipelineId_componentKey_idx" ON "EventSample"("pipelineId", "componentKey");

-- AddForeignKey
ALTER TABLE "EventSampleRequest" ADD CONSTRAINT "EventSampleRequest_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSample" ADD CONSTRAINT "EventSample_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "EventSampleRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSample" ADD CONSTRAINT "EventSample_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
