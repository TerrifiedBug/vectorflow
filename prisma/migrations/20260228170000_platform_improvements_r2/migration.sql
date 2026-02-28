-- Pipeline: add updatedById
ALTER TABLE "Pipeline" ADD COLUMN "updatedById" TEXT;
ALTER TABLE "Pipeline" ADD CONSTRAINT "Pipeline_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AuditLog: add IP and denormalized user info
ALTER TABLE "AuditLog" ADD COLUMN "ipAddress" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "userEmail" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "userName" TEXT;

-- Environment: add per-environment git credentials
ALTER TABLE "Environment" ADD COLUMN "gitSshKey" BYTEA;
ALTER TABLE "Environment" ADD COLUMN "gitHttpsToken" TEXT;
ALTER TABLE "Environment" ADD COLUMN "gitCommitAuthor" TEXT;

-- SystemSettings: remove global git credentials
ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "gitopsCommitAuthor";
ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "gitopsSshKey";
ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "gitopsHttpsToken";
