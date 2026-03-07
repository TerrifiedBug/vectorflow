-- CreateTable
CREATE TABLE "PipelineSli" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "windowMinutes" INTEGER NOT NULL DEFAULT 5,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineSli_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineSli_pipelineId_idx" ON "PipelineSli"("pipelineId");

-- AddForeignKey
ALTER TABLE "PipelineSli" ADD CONSTRAINT "PipelineSli_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
