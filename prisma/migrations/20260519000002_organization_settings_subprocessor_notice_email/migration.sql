-- Add OrganizationSettings.subprocessorNoticeEmail.
--
-- Nullable, optional. NULL means "this organization has not subscribed
-- to sub-processor change notices"; the operator's notice-dispatch job
-- iterates settings rows and skips NULL entries. The transport (SMTP,
-- marketing-platform, etc.) lives behind the operator surface and is
-- not modelled in this OSS schema.
--
-- Rollback:
--   ALTER TABLE "OrganizationSettings"
--     DROP COLUMN "subprocessorNoticeEmail";

ALTER TABLE "OrganizationSettings"
  ADD COLUMN "subprocessorNoticeEmail" TEXT;

COMMENT ON COLUMN "OrganizationSettings"."subprocessorNoticeEmail" IS
  'Address that receives sub-processor change notices. NULL = not subscribed.';
