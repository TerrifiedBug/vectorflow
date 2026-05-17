-- Click-through terms acceptance fields on Organization.
--
-- Captures the timestamp and version identifier of the published
-- terms / privacy / AUP that a multi-tenant signup flow had the OWNER
-- accept. Both columns are nullable: single-tenant deployments that
-- bypass click-through leave them NULL.
--
-- Forced re-acceptance on terms revision is implemented at the app
-- layer by comparing `acceptedTermsVersion` against the operator's
-- current published version and showing a re-accept gate when they
-- differ.
--
-- Rollback:
--   ALTER TABLE "Organization" DROP COLUMN "acceptedTermsVersion";
--   ALTER TABLE "Organization" DROP COLUMN "acceptedTermsAt";

ALTER TABLE "Organization"
  ADD COLUMN "acceptedTermsAt"      TIMESTAMP(3),
  ADD COLUMN "acceptedTermsVersion" TEXT;

COMMENT ON COLUMN "Organization"."acceptedTermsAt" IS
  'Timestamp the OWNER clicked-through the published terms. NULL when single-tenant signup bypasses acceptance.';
COMMENT ON COLUMN "Organization"."acceptedTermsVersion" IS
  'Version identifier of the terms the OWNER accepted. NULL when click-through was bypassed.';
