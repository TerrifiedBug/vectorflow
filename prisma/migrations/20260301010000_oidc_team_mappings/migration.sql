-- Add OIDC team mapping fields
ALTER TABLE "SystemSettings" ADD COLUMN "oidcTeamMappings" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "oidcDefaultTeamId" TEXT;

-- Migrate existing role mappings to team mappings (targeting first team)
-- This preserves existing OIDC behavior during the transition
UPDATE "SystemSettings" s
SET "oidcDefaultTeamId" = (SELECT id FROM "Team" ORDER BY "createdAt" ASC LIMIT 1)
WHERE s.id = 'singleton';
