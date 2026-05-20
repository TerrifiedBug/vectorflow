-- Operator-only escape hatch for the C.4 OIDC issuer DNS gate.
--
-- Add OrganizationSettings.allowSharedIdpHostnames. NOT NULL with a
-- false default so existing rows keep the strict-gate behaviour shipped
-- with PR #375 / audit gap C.4. When operators flip this to TRUE for a
-- given org (via an OperatorApprovalRequest), `settings.updateOidc`
-- will accept issuers whose hostname is not covered by a verified
-- OrganizationDomainClaim — required for shared third-party IdPs like
-- `accounts.google.com`, `login.microsoftonline.com/<tenant>/v2.0`, or
-- `<workspace>.okta.com` which no single tenant can claim under DNS-TXT.
--
-- Rollback:
--   ALTER TABLE "OrganizationSettings"
--     DROP COLUMN "allowSharedIdpHostnames";

ALTER TABLE "OrganizationSettings"
  ADD COLUMN "allowSharedIdpHostnames" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "OrganizationSettings"."allowSharedIdpHostnames" IS
  'Operator-only flag. When TRUE, settings.updateOidc skips the verified-domain-claim check.';
