-- scripts/grant-vectorflow-app.sql
--
-- Post-provisioning helper for Phase 4c (`prisma/migrations/20260516000006`).
--
-- Re-applies all GRANT and ALTER DEFAULT PRIVILEGES statements that the
-- Phase 4c migration would have applied to `vectorflow_app`. Run this when:
--
--   1. The Phase 4c migration ran against a managed Postgres where the
--      migrating role lacked CREATEROLE/SUPERUSER (so step 1 short-
--      circuited with a NOTICE), AND
--   2. You later provisioned the `vectorflow_app` role out of band
--      (Terraform, IaC, manual psql as cluster admin), AND
--   3. The role now exists but lacks the runtime grants because the
--      migration was already marked applied in Prisma's ledger.
--
-- This script is safe to re-run; every statement is idempotent on its
-- own (GRANT is additive, ALTER DEFAULT PRIVILEGES updates the existing
-- ACL entry).
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/grant-vectorflow-app.sql
--
-- Required privileges: the role running this script must own the public
-- schema and the target tables (typically the Prisma migrate user).

\set ON_ERROR_STOP on

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vectorflow_app') THEN
        RAISE EXCEPTION 'vectorflow_app role does not exist. Provision it first (CREATE ROLE vectorflow_app NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS LOGIN INHERIT;) then re-run this script.';
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO vectorflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vectorflow_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO vectorflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vectorflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO vectorflow_app;

-- Sanity assertion mirrors the Phase 4c migration's invariant check.
DO $$
DECLARE
    has_bypass boolean;
    is_super   boolean;
    can_login  boolean;
BEGIN
    SELECT rolbypassrls, rolsuper, rolcanlogin
      INTO has_bypass, is_super, can_login
      FROM pg_roles
     WHERE rolname = 'vectorflow_app';

    IF has_bypass THEN
        RAISE EXCEPTION 'phase4c invariant violated: vectorflow_app has BYPASSRLS';
    END IF;
    IF is_super THEN
        RAISE EXCEPTION 'phase4c invariant violated: vectorflow_app is SUPERUSER';
    END IF;
    IF NOT can_login THEN
        RAISE EXCEPTION 'phase4c invariant violated: vectorflow_app cannot LOGIN';
    END IF;
    RAISE NOTICE 'phase4c-post-provision: grants applied and invariants verified for vectorflow_app';
END
$$;
