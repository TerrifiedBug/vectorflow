-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN "oidcGroupSyncEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN "oidcGroupsScope" TEXT DEFAULT 'groups';

-- Enable group sync for rows that already have mappings or a default team configured
UPDATE "SystemSettings"
SET "oidcGroupSyncEnabled" = true
WHERE ("oidcTeamMappings" IS NOT NULL AND "oidcTeamMappings" != '[]' AND "oidcTeamMappings" != '')
   OR "oidcDefaultTeamId" IS NOT NULL;
