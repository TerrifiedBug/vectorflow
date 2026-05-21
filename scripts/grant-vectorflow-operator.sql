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
--   3. An operator role consumer needs read access to the views but the
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
    leak record;
    leak_count integer := 0;
BEGIN
    -- Use has_table_privilege() so we catch privileges INHERITed from
    -- parent roles, not just direct GRANTs to vectorflow_operator
    -- specifically. has_table_privilege() resolves the effective
    -- privilege the runtime would see, which is the boundary that
    -- actually matters.
    FOR leak IN
        SELECT c.relname AS tbl
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'  -- ordinary tables; views are relkind = 'v'
           AND has_table_privilege('vectorflow_operator', c.oid, 'SELECT')
    LOOP
        RAISE WARNING 'phase4d boundary leak: vectorflow_operator has effective SELECT on base table %', leak.tbl;
        leak_count := leak_count + 1;
    END LOOP;

    IF leak_count > 0 THEN
        RAISE EXCEPTION 'phase4d: vectorflow_operator has effective SELECT on % base table(s) (incl. via INHERIT). Revoke or REVOKE INHERIT to preserve the masking boundary.', leak_count;
    END IF;

    RAISE NOTICE 'phase4d-post-provision: vectorflow_operator confirmed view-only (effective-privilege check, covers INHERIT)';
END
$$;
