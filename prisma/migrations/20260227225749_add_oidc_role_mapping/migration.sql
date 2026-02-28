-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "oidcAdminGroups" TEXT,
ADD COLUMN     "oidcDefaultRole" "Role" NOT NULL DEFAULT 'VIEWER',
ADD COLUMN     "oidcEditorGroups" TEXT,
ADD COLUMN     "oidcGroupsClaim" TEXT DEFAULT 'groups';
