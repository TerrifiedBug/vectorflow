-- Fix: Pipeline delete fails with FK constraint on PipelineVersion
-- Add cascade delete so versions are removed when a pipeline is deleted
ALTER TABLE "PipelineVersion" DROP CONSTRAINT "PipelineVersion_pipelineId_fkey";
ALTER TABLE "PipelineVersion" ADD CONSTRAINT "PipelineVersion_pipelineId_fkey"
    FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
