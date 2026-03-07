-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN "oidcGroupSyncEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN "oidcGroupsScope" TEXT DEFAULT 'groups';
