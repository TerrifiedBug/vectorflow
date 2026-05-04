ALTER TABLE "VectorNode" ADD COLUMN "nodeTokenId" TEXT;

CREATE UNIQUE INDEX "VectorNode_nodeTokenId_key" ON "VectorNode"("nodeTokenId");
