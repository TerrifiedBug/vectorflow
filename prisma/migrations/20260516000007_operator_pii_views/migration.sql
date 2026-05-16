-- Phase 4d — PII-masking views for the operator role.
--
-- Cloud operators need a view of the fleet to do their job (suspend abusive
-- orgs, audit break-glass usage, see who's on which plan tier) WITHOUT being
-- able to read customer pipelines, configs, secrets, or email addresses.
-- These views project the metadata an operator legitimately needs and mask
-- everything else — including masking email addresses so an operator can
-- still match a support request to an account without seeing the full
-- personal email.
--
-- The views ship in OSS because they are pure SQL with zero runtime cost
-- when unused. The `vectorflow_operator` role itself is Cloud-private
-- (provisioned out of band, same pattern as `vectorflow_app` in Phase 4c).
-- When that role exists, this migration grants it SELECT on each view —
-- and ONLY on the views, never on the underlying tables.
--
-- ─── Identifier quoting ───────────────────────────────────────────────────
-- Prisma generates tables and columns with double-quoted, case-preserved
-- identifiers (`"Organization"`, `"suspendedAt"`). Unquoted references in
-- SQL get folded to lowercase by Postgres, which would resolve to columns
-- that DO NOT exist (`suspendedat`). Every identifier in this file is
-- explicitly double-quoted to round-trip the camelCase casing.
--
-- ─── Rollback ─────────────────────────────────────────────────────────────
-- DROP VIEW IF EXISTS public.vw_operator_organization_summary CASCADE;
-- DROP VIEW IF EXISTS public.vw_operator_user_summary CASCADE;
-- DROP VIEW IF EXISTS public.vw_operator_audit_summary CASCADE;
-- DROP VIEW IF EXISTS public.vw_operator_org_access_grant_log CASCADE;

-- ─── 1. Organization summary ──────────────────────────────────────────────
CREATE OR REPLACE VIEW public.vw_operator_organization_summary AS
SELECT
    o."id",
    o."slug",
    o."name",
    o."plan",
    o."region",
    o."suspendedAt",
    o."deletedAt",
    o."createdAt",
    o."updatedAt",
    (SELECT count(*) FROM "OrgMember" m WHERE m."organizationId" = o."id") AS member_count,
    -- Surface only the PRESENCE of envelope-encryption material, never the
    -- ciphertext or KMS ARN itself.
    (o."dataKeyCiphertext" IS NOT NULL) AS has_data_key,
    (o."kmsKeyArn"         IS NOT NULL) AS has_kms_key,
    (o."byokKeyArn"        IS NOT NULL) AS has_byok_key
FROM "Organization" o;

COMMENT ON VIEW public.vw_operator_organization_summary IS
  'Phase 4d: operator-safe projection of Organization. Excludes dataKeyCiphertext, kmsKeyArn, byokKeyArn. See plan §5 (operator boundary).';

-- ─── 2. User summary with masked email ────────────────────────────────────
-- Mask local part: keep first character + "***". e.g. "alice@example.com"
-- becomes "a***@example.com"; "bob+filter@corp.io" becomes "b***@corp.io".
-- If the email has no "@" (shouldn't, but defensive), mask the whole thing.
CREATE OR REPLACE VIEW public.vw_operator_user_summary AS
SELECT
    u."id",
    CASE
        WHEN position('@' IN u."email") > 1
            THEN substring(u."email" FOR 1) || '***' || substring(u."email" FROM position('@' IN u."email"))
        ELSE '***'
    END AS email_masked,
    -- The full email's domain is operationally useful (which corp account
    -- got compromised); the local part is the PII we're hiding.
    CASE
        WHEN position('@' IN u."email") > 0
            THEN substring(u."email" FROM position('@' IN u."email") + 1)
        ELSE NULL
    END AS email_domain,
    u."authMethod",
    u."lockedAt",
    u."createdAt",
    (SELECT count(*) FROM "OrgMember" m WHERE m."userId" = u."id") AS org_membership_count
FROM "User" u;

COMMENT ON VIEW public.vw_operator_user_summary IS
  'Phase 4d: operator-safe projection of User. Email local-part masked; password hash, name, image excluded.';

-- ─── 3. Audit summary without entity diffs ────────────────────────────────
CREATE OR REPLACE VIEW public.vw_operator_audit_summary AS
SELECT
    a."id",
    a."createdAt",
    a."organizationId",
    a."teamId",
    a."environmentId",
    a."action",
    a."entityType",
    a."entityId",
    a."userId",
    a."userName",
    a."ipAddress",
    -- diff JSON masked: operators see THAT a change happened, not WHAT
    -- changed. Customer-visible audit pages keep the full diff via the
    -- customer connection (which goes through vectorflow_app, not the
    -- operator role).
    NULL::jsonb AS diff_masked,
    -- Hash chain integrity stays visible so operators can detect tampering.
    a."prevHash",
    a."hash"
FROM "AuditLog" a;

COMMENT ON VIEW public.vw_operator_audit_summary IS
  'Phase 4d: operator-safe projection of AuditLog. Entity diff masked to NULL; chain hashes preserved for tamper-evidence verification.';

-- ─── 4. Org access grant log ──────────────────────────────────────────────
-- Operator break-glass usage. Surfaced largely unredacted because this is
-- operator-self-monitoring; auditors and customers should also see this
-- (via a separate customer-facing path), so masking would defeat its
-- purpose. The kmsGrantToken column IS masked since it's the live decrypt
-- capability — surface only its presence.
CREATE OR REPLACE VIEW public.vw_operator_org_access_grant_log AS
SELECT
    g."id",
    g."organizationId",
    g."operatorId",
    g."approvedByCustomerAdminId",
    g."reason",
    g."expiresAt",
    g."revokedAt",
    g."createdAt",
    (g."kmsGrantToken" IS NOT NULL) AS has_kms_grant_token
FROM "OrgAccessGrant" g;

COMMENT ON VIEW public.vw_operator_org_access_grant_log IS
  'Phase 4d: full break-glass grant audit for the operator console. kmsGrantToken masked to a boolean presence flag.';

-- ─── 5. Grant SELECT on views to vectorflow_operator (when role exists) ──
-- Same idempotent-skip pattern as Phase 4c. The role is Cloud-private; on
-- OSS this short-circuits and the views simply exist as unused projections.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vectorflow_operator') THEN
        RAISE NOTICE
          'phase4d: vectorflow_operator role absent — skipping view grants. Provision the role and run scripts/grant-vectorflow-operator.sql if you intend to use the operator console.';
        RETURN;
    END IF;

    EXECUTE 'GRANT USAGE ON SCHEMA public TO vectorflow_operator';
    EXECUTE 'GRANT SELECT ON public.vw_operator_organization_summary TO vectorflow_operator';
    EXECUTE 'GRANT SELECT ON public.vw_operator_user_summary           TO vectorflow_operator';
    EXECUTE 'GRANT SELECT ON public.vw_operator_audit_summary          TO vectorflow_operator';
    EXECUTE 'GRANT SELECT ON public.vw_operator_org_access_grant_log   TO vectorflow_operator';

    RAISE NOTICE 'phase4d: granted SELECT on four operator views to vectorflow_operator';
END
$$;
