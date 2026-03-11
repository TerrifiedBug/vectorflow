-- AlterTable
ALTER TABLE "AiConversation" ADD COLUMN "componentKey" TEXT;

-- AlterTable
ALTER TABLE "AiMessage" ADD COLUMN "vrlCode" TEXT;

-- CreateIndex
CREATE INDEX "AiConversation_pipelineId_componentKey_idx" ON "AiConversation"("pipelineId", "componentKey");
