-- CreateIndex
CREATE INDEX "PipelineNode_pipelineId_idx" ON "PipelineNode"("pipelineId");

-- CreateIndex
CREATE INDEX "PipelineEdge_pipelineId_idx" ON "PipelineEdge"("pipelineId");

-- CreateIndex
CREATE INDEX "PipelineVersion_pipelineId_version_idx" ON "PipelineVersion"("pipelineId", "version");
