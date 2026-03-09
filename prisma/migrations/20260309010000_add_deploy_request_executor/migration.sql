-- AlterTable
ALTER TABLE "DeployRequest" ADD COLUMN "deployedAt" TIMESTAMP(3);
ALTER TABLE "DeployRequest" ADD COLUMN "deployedById" TEXT;

-- AddForeignKey
ALTER TABLE "DeployRequest" ADD CONSTRAINT "DeployRequest_deployedById_fkey" FOREIGN KEY ("deployedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
