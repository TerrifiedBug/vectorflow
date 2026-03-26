-- CreateTable
CREATE TABLE "PipelineDependency" (
    "id" TEXT NOT NULL,
    "upstreamId" TEXT NOT NULL,
    "downstreamId" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineDependency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineDependency_upstreamId_idx" ON "PipelineDependency"("upstreamId");

-- CreateIndex
CREATE INDEX "PipelineDependency_downstreamId_idx" ON "PipelineDependency"("downstreamId");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineDependency_upstreamId_downstreamId_key" ON "PipelineDependency"("upstreamId", "downstreamId");

-- AddForeignKey
ALTER TABLE "PipelineDependency" ADD CONSTRAINT "PipelineDependency_upstreamId_fkey" FOREIGN KEY ("upstreamId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineDependency" ADD CONSTRAINT "PipelineDependency_downstreamId_fkey" FOREIGN KEY ("downstreamId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
