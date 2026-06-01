-- Identity provenance for SCIM / local-user coexistence.
--
-- Records how each OrgMember row was created so SCIM deprovisioning can be
-- scoped to the memberships the IdP actually provisioned, leaving locally
-- created members (signup, invite, the founding OWNER) untouched.
--
-- Existing rows default to LOCAL: they predate SCIM provenance tracking and
-- MUST be treated as local (and therefore protected from SCIM removal) until
-- an IdP explicitly (re)provisions them. The column is NOT NULL with a
-- constant default, so the add is metadata-only — no table rewrite, no
-- separate backfill. RLS is unaffected (the policy keys on organizationId).

-- CreateEnum
CREATE TYPE "OrgMemberProvenance" AS ENUM ('LOCAL', 'SCIM', 'OIDC');

-- AlterTable
ALTER TABLE "OrgMember" ADD COLUMN "provisionedVia" "OrgMemberProvenance" NOT NULL DEFAULT 'LOCAL';
