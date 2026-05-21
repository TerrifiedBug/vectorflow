-- Add `organizationId` to `ScimGroup` so SCIM groups belong to a single
-- organisation. Closes
-- — without this, a SCIM bearer token issued for org A could list and
-- mutate ScimGroup rows owned by org B because the table had no tenant
-- column at all.
--
-- Backfill: existing groups are bound to DEFAULT_ORG_ID. Multi-tenant
-- deployments today have no production SCIM users so the backfill is a
-- no-op in cloud. OSS single-tenant continues to work because every
-- ScimGroup row already belongs to the single org.

-- 1. Add column with safe default so the table is writable mid-deploy.
ALTER TABLE "ScimGroup"
    ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';

-- 2. Drop the old global-uniqueness constraints; recreate as org-scoped.
DROP INDEX IF EXISTS "ScimGroup_displayName_key";
DROP INDEX IF EXISTS "ScimGroup_externalId_key";

CREATE UNIQUE INDEX "ScimGroup_organizationId_displayName_key"
    ON "ScimGroup"("organizationId", "displayName");
CREATE UNIQUE INDEX "ScimGroup_organizationId_externalId_key"
    ON "ScimGroup"("organizationId", "externalId");
CREATE INDEX "ScimGroup_organizationId_idx"
    ON "ScimGroup"("organizationId");

-- 3. FK + ON DELETE CASCADE matches the OrgMember / Settings cascade
--    so deleting an Organization tears down its SCIM groups.
ALTER TABLE "ScimGroup"
    ADD CONSTRAINT "ScimGroup_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
