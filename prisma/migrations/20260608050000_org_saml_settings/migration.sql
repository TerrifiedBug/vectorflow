-- Per-org SAML SSO settings (CL-3). Mirrors the existing per-org OIDC
-- columns on OrganizationSettings and coexists with OIDC + local auth.
--
-- All columns are additive:
--   * samlEnabled / samlEnforced  — NOT NULL, DEFAULT false, so every
--     existing row keeps SAML off and local/OIDC auth unchanged.
--   * samlIdpEntityId / samlIdpSsoUrl / samlIdpCert / samlGroupAttribute
--     — nullable TEXT, NULL until an org admin configures its IdP.
--
-- `samlIdpCert` holds the IdP's PUBLIC signing certificate (PEM). It is a
-- public credential — unlike `oidcClientSecret` it is NOT encrypted at rest.
-- Group→team reconciliation reuses the shared `oidcTeamMappings` mechanism,
-- keyed by the assertion attribute named in `samlGroupAttribute`.
--
-- OrganizationSettings already carries RLS (organizationId-scoped); adding
-- columns does not change the row-level policy, so no RLS block is needed.
--
-- Rollback:
--   ALTER TABLE "OrganizationSettings"
--     DROP COLUMN "samlEnabled",
--     DROP COLUMN "samlIdpEntityId",
--     DROP COLUMN "samlIdpSsoUrl",
--     DROP COLUMN "samlIdpCert",
--     DROP COLUMN "samlEnforced",
--     DROP COLUMN "samlGroupAttribute";

ALTER TABLE "OrganizationSettings"
  ADD COLUMN "samlEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "samlIdpEntityId" TEXT,
  ADD COLUMN "samlIdpSsoUrl" TEXT,
  ADD COLUMN "samlIdpCert" TEXT,
  ADD COLUMN "samlEnforced" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "samlGroupAttribute" TEXT;

COMMENT ON COLUMN "OrganizationSettings"."samlIdpCert" IS
  'IdP public signing certificate (PEM). Public credential — stored in plaintext, never encrypted.';
COMMENT ON COLUMN "OrganizationSettings"."samlEnforced" IS
  'When TRUE and SAML is fully configured, local credential login is disabled for the org (SAML SSO is mandatory).';
