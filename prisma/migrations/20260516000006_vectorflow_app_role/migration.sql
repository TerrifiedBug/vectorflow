-- Phase 4c — vectorflow_app non-owner Postgres role.
--
-- Creates the runtime role used by the application connection pool in
-- Cloud deployments. The role has NOBYPASSRLS, NOSUPERUSER, NOCREATEROLE,
-- NOCREATEDB so the strict RLS policy installed in 20260516000003 actually
-- fences cross-org access at the database layer. The table-owner role
-- bypasses RLS by default in Postgres; we explicitly do NOT use the owner
-- role at runtime in Cloud.
--
-- OSS / self-hosted deployments don't need to switch roles. They can keep
-- using the owner role and rely on application-level org filtering plus the
-- "default" org assignment. Setting DATABASE_URL to a vectorflow_app-
-- credentialed connection string is what flips the runtime role at deploy
-- time; this migration only ensures the role and its grants CAN exist.
--
-- The migration is idempotent: re-running it neither errors nor changes
-- effective permissions.
--
-- ─── Rollback ──────────────────────────────────────────────────────────────
-- REASSIGN OWNED BY vectorflow_app TO <owner>;
-- DROP OWNED BY vectorflow_app;
-- DROP ROLE vectorflow_app;
-- (DROP OWNED must run for each database; will fail if any active session
-- still references the role — disconnect the app first.)

-- ─── 1. Create the role if it does not already exist ──────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vectorflow_app') THEN
        CREATE ROLE vectorflow_app
            NOSUPERUSER NOCREATEROLE NOCREATEDB
            NOBYPASSRLS LOGIN
            INHERIT;
        RAISE NOTICE 'phase4c: created role vectorflow_app (NOBYPASSRLS, NOSUPERUSER)';
    ELSE
        -- Defend against a pre-existing role being granted BYPASSRLS
        -- elsewhere; force it off here so the RLS backstop is never silently
        -- defeated.
        ALTER ROLE vectorflow_app NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
        RAISE NOTICE 'phase4c: role vectorflow_app already present, attributes reasserted';
    END IF;
END
$$;

-- ─── 2. Schema-level access ───────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO vectorflow_app;

-- ─── 3. Existing-object grants ────────────────────────────────────────────
-- All current tables and sequences. Future tables are handled by the
-- ALTER DEFAULT PRIVILEGES block below.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vectorflow_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO vectorflow_app;

-- ─── 4. Default privileges for future migrations ──────────────────────────
-- Anything CREATEd in `public` from here on by the migrating role inherits
-- these grants without an explicit GRANT statement per table.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vectorflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO vectorflow_app;

-- ─── 5. Sanity assertion ──────────────────────────────────────────────────
-- A separate transaction step that confirms the new role is properly fenced.
-- Surfaces in migration output for the operator to spot-check.
DO $$
DECLARE
    has_bypass boolean;
    is_super   boolean;
BEGIN
    SELECT rolbypassrls, rolsuper
      INTO has_bypass, is_super
      FROM pg_roles
     WHERE rolname = 'vectorflow_app';

    IF has_bypass THEN
        RAISE EXCEPTION 'phase4c invariant violated: vectorflow_app has BYPASSRLS';
    END IF;
    IF is_super THEN
        RAISE EXCEPTION 'phase4c invariant violated: vectorflow_app is SUPERUSER';
    END IF;
    RAISE NOTICE 'phase4c: vectorflow_app fenced (NOBYPASSRLS=true, NOSUPERUSER=true)';
END
$$;
