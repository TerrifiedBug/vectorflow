-- scripts/grant-vectorflow-operator.sql
--
-- Post-provisioning helper for Phase 4d (`prisma/migrations/20260516000007`).
--
-- Grants SELECT on the four operator PII-masking views to the
-- `vectorflow_operator` role. Run this when:
--
--   1. The Phase 4d migration ran while `vectorflow_operator` did not
--      yet exist (it short-circuited with a NOTICE), AND
--   2. You later provisioned the role out of band (Terraform, manual
--      psql as cluster admin), AND
--   3. The operator console needs read access to the views but the
--      grants from the migration never landed.
--
-- The role intentionally never gets SELECT on the underlying tables;
-- views are the only access path so the operator can never bypass the
-- masking logic.
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/grant-vectorflow-operator.sql

\set ON_ERROR_STOP on

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vectorflow_operator') THEN
        RAISE EXCEPTION 'vectorflow_operator role does not exist. Provision it first (CREATE ROLE vectorflow_operator NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS LOGIN INHERIT;) then re-run this script.';
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO vectorflow_operator;
GRANT SELECT ON public.vw_operator_organization_summary  TO vectorflow_operator;
GRANT SELECT ON public.vw_operator_user_summary          TO vectorflow_operator;
GRANT SELECT ON public.vw_operator_audit_summary         TO vectorflow_operator;
GRANT SELECT ON public.vw_operator_org_access_grant_log  TO vectorflow_operator;

-- Sanity assertion: the operator role MUST NOT have any direct
-- table grants. If it does, that's a config drift / leak; fail loud.
DO $$
DECLARE
    direct_grants integer;
BEGIN
    SELECT count(*)
      INTO direct_grants
      FROM information_schema.role_table_grants
     WHERE grantee = 'vectorflow_operator'
       AND table_schema = 'public'
       AND table_name NOT LIKE 'vw_operator_%';

    IF direct_grants > 0 THEN
        RAISE EXCEPTION 'phase4d: vectorflow_operator has % direct table grant(s) outside the operator views. Revoke them to preserve the masking boundary.', direct_grants;
    END IF;

    RAISE NOTICE 'phase4d-post-provision: vectorflow_operator confirmed view-only';
END
$$;
