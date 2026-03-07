-- AlterTable
ALTER TABLE "Environment" ADD COLUMN "requireDeployApproval" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DeployRequest" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "configYaml" TEXT NOT NULL,
    "changelog" TEXT NOT NULL,
    "nodeSelector" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "DeployRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeployRequest_pipelineId_status_idx" ON "DeployRequest"("pipelineId", "status");

-- CreateIndex
CREATE INDEX "DeployRequest_environmentId_status_idx" ON "DeployRequest"("environmentId", "status");

-- AddForeignKey
ALTER TABLE "DeployRequest" ADD CONSTRAINT "DeployRequest_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeployRequest" ADD CONSTRAINT "DeployRequest_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeployRequest" ADD CONSTRAINT "DeployRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeployRequest" ADD CONSTRAINT "DeployRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
