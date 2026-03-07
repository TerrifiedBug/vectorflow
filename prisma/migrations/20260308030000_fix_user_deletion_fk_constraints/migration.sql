-- DropForeignKey
ALTER TABLE "TeamMember" DROP CONSTRAINT "TeamMember_userId_fkey";
ALTER TABLE "VrlSnippet" DROP CONSTRAINT "VrlSnippet_createdBy_fkey";
ALTER TABLE "DeployRequest" DROP CONSTRAINT "DeployRequest_requestedById_fkey";
ALTER TABLE "ServiceAccount" DROP CONSTRAINT "ServiceAccount_createdById_fkey";

-- AlterTable (make columns nullable where needed)
ALTER TABLE "VrlSnippet" ALTER COLUMN "createdBy" DROP NOT NULL;
ALTER TABLE "DeployRequest" ALTER COLUMN "requestedById" DROP NOT NULL;
ALTER TABLE "ServiceAccount" ALTER COLUMN "createdById" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VrlSnippet" ADD CONSTRAINT "VrlSnippet_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeployRequest" ADD CONSTRAINT "DeployRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceAccount" ADD CONSTRAINT "ServiceAccount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
