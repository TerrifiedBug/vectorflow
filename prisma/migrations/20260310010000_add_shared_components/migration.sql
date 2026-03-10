-- CreateTable
CREATE TABLE "SharedComponent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "componentType" TEXT NOT NULL,
    "kind" "ComponentKind" NOT NULL,
    "config" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "environmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedComponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SharedComponent_environmentId_name_key" ON "SharedComponent"("environmentId", "name");

-- CreateIndex
CREATE INDEX "SharedComponent_environmentId_idx" ON "SharedComponent"("environmentId");

-- AlterTable
ALTER TABLE "PipelineNode" ADD COLUMN "sharedComponentId" TEXT;
ALTER TABLE "PipelineNode" ADD COLUMN "sharedComponentVersion" INTEGER;

-- CreateIndex
CREATE INDEX "PipelineNode_sharedComponentId_idx" ON "PipelineNode"("sharedComponentId");

-- AddForeignKey
ALTER TABLE "PipelineNode" ADD CONSTRAINT "PipelineNode_sharedComponentId_fkey" FOREIGN KEY ("sharedComponentId") REFERENCES "SharedComponent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedComponent" ADD CONSTRAINT "SharedComponent_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
