-- Phase 4c — vectorflow_app non-owner Postgres role.
--
-- Creates the runtime role used by the application connection pool in
-- Multi-tenant deployments. The role has NOBYPASSRLS, NOSUPERUSER, NOCREATEROLE,
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
-- ─── Managed Postgres compatibility ─────────────────────────────────────
-- Managed Postgres (AWS RDS, Aurora, Supabase, Neon, etc.) typically does
-- NOT grant CREATEROLE or SUPERUSER to the app/owner role that runs
-- migrations. CREATE ROLE / ALTER ROLE need one of those privileges, so
-- running role DDL there would abort with "permission denied to create
-- role" before any of the GRANTs could land — breaking the upgrade for
-- every OSS / self-hosted user on managed Postgres even though they don't
-- intend to use vectorflow_app at all.
--
-- The migration therefore short-circuits with a NOTICE when the current
-- user lacks CREATEROLE/SUPERUSER. Operators provision the role
-- out of band (Terraform, manual psql as the cluster admin); when this
-- migration runs against that pre-provisioned role, the ALTER path
-- reasserts the expected attributes idempotently.
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

-- ─── 1. Create / alter the role (gated on CREATEROLE/SUPERUSER) ──────────
DO $$
DECLARE
    can_manage_roles boolean;
BEGIN
    SELECT (rolsuper OR rolcreaterole)
      INTO can_manage_roles
      FROM pg_roles
     WHERE rolname = current_user;

    IF NOT can_manage_roles THEN
        RAISE NOTICE
          'phase4c: skipping vectorflow_app role provisioning — current_user (%) lacks CREATEROLE/SUPERUSER. Provision the role out of band if you intend to use it for the runtime connection pool.',
          current_user;
        RETURN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vectorflow_app') THEN
        CREATE ROLE vectorflow_app
            NOSUPERUSER NOCREATEROLE NOCREATEDB
            NOBYPASSRLS LOGIN
            INHERIT;
        RAISE NOTICE 'phase4c: created role vectorflow_app (NOBYPASSRLS, NOSUPERUSER, LOGIN)';
    ELSE
        -- Defend against a pre-existing role provisioned with NOLOGIN or
        -- granted BYPASSRLS elsewhere. Reassert every attribute the runtime
        -- expects so a re-run guarantees the same role shape regardless of
        -- how it was originally created (manual psql, IaC, prior migration).
        ALTER ROLE vectorflow_app
            NOSUPERUSER NOCREATEROLE NOCREATEDB
            NOBYPASSRLS LOGIN INHERIT;
        RAISE NOTICE 'phase4c: role vectorflow_app already present, attributes reasserted (incl. LOGIN)';
    END IF;
END
$$;

-- ─── 2. Grants (gated on role existence) ──────────────────────────────────
-- These only have an effect when vectorflow_app actually exists. Wrap in
-- a DO so we skip cleanly on managed Postgres where step 1 short-circuited;
-- GRANT itself only needs ownership of the target objects (not CREATEROLE),
-- but the role must exist to be a grantee.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vectorflow_app') THEN
        RAISE NOTICE 'phase4c: vectorflow_app role absent — skipping grants.';
        RETURN;
    END IF;

    -- Schema usage
    EXECUTE 'GRANT USAGE ON SCHEMA public TO vectorflow_app';

    -- All current tables and sequences. Future tables are handled by the
    -- ALTER DEFAULT PRIVILEGES block below.
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vectorflow_app';
    EXECUTE 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO vectorflow_app';

    -- Anything CREATEd in `public` from here on by the migrating role
    -- inherits these grants without an explicit GRANT statement per table.
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vectorflow_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO vectorflow_app';
END
$$;

-- ─── 3. Sanity assertion (gated on role existence) ────────────────────────
-- Surfaces in migration output so operators can spot-check that the role
-- hasn't drifted from its intended shape. Skipped cleanly when the role is
-- absent (managed Postgres + no out-of-band provisioning).
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

    IF NOT FOUND THEN
        RAISE NOTICE 'phase4c: vectorflow_app absent — invariant check skipped.';
        RETURN;
    END IF;

    IF has_bypass THEN
        RAISE EXCEPTION 'phase4c invariant violated: vectorflow_app has BYPASSRLS';
    END IF;
    IF is_super THEN
        RAISE EXCEPTION 'phase4c invariant violated: vectorflow_app is SUPERUSER';
    END IF;
    IF NOT can_login THEN
        RAISE EXCEPTION 'phase4c invariant violated: vectorflow_app cannot LOGIN (the runtime would fail to authenticate)';
    END IF;
    RAISE NOTICE 'phase4c: vectorflow_app fenced (NOBYPASSRLS=true, NOSUPERUSER=true, LOGIN=true)';
END
$$;
