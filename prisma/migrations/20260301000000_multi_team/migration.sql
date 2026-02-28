-- AlterTable: Add isSuperAdmin to User
ALTER TABLE "User" ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Add teamId to AuditLog
ALTER TABLE "AuditLog" ADD COLUMN "teamId" TEXT;

-- Data migration: promote existing ADMINs to super admin
UPDATE "User" SET "isSuperAdmin" = true
WHERE id IN (
  SELECT DISTINCT "userId" FROM "TeamMember" WHERE role = 'ADMIN'
);
