-- Phase 5a hotfix (Codex P0) — strict RLS policies.
--
-- The previous migration (`20260516000001_phase5a_rls_and_composite_indexes`)
-- installed a policy with an "allow when `app.org_id` is unset" branch:
--
--   USING (
--     "organizationId" = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'app_org_id_unset_sentinel')
--     OR COALESCE(NULLIF(current_setting('app.org_id', true), ''), '') = ''
--   )
--
-- That OR-branch makes the policy evaluate true for every row whenever the
-- session GUC is empty, defeating the backstop on any code path that
-- forgets to call `withOrgTx`. The intended behaviour ("OSS bypasses RLS")
-- comes from PostgreSQL's table-owner-bypasses-RLS default — NOT from a
-- runtime escape in the policy itself.
--
-- This migration DROPs the permissive policy on every tenant table and
-- replaces it with a strict one:
--
--   USING ("organizationId" = current_setting('app.org_id', true))
--   WITH CHECK (...)
--
-- When `app.org_id` is unset, `current_setting('app.org_id', true)`
-- returns NULL; the equality is NULL (i.e. FALSE) so no rows are visible.
-- OSS continues to bypass RLS because the table-owner role bypasses by
-- default; Cloud's non-owner role is properly fenced.
--
-- ─── TimescaleDB columnstore ───────────────────────────────────────────────
-- Hypertables with columnstore enabled (PipelineLog, NodeMetric,
-- PipelineMetric) never had RLS enabled in 20260516000001 — `ALTER TABLE …
-- ENABLE ROW LEVEL SECURITY` is blocked when columnstore is on, and
-- TimescaleDB does not propagate parent policies to chunks anyway
-- (timescale/timescaledb#7830). The same feature-detect skip lives here so
-- this migration is symmetric with 000001: we do NOT install a strict
-- policy on a table where RLS is still disabled (it would be a dormant
-- policy with no effect). Isolation for these tables is the `withOrgTx`
-- GUC plus the composite `(organizationId, …)` indexes installed in
-- 20260516000001.
--
-- ─── Rollback ──────────────────────────────────────────────────────────────
-- If we ever need to revert: re-create the previous CREATE POLICY shape on
-- each table after DROP POLICY. The full text lived in the body of
-- migration 20260516000001.

DO $$
DECLARE
    tbl text;
    has_timescaledb boolean;
    compressed_hypertables text[] := ARRAY[]::text[];
    tenant_tables text[] := ARRAY[
        'Pipeline', 'PipelineVersion', 'PipelineLog',
        'NodeMetric', 'PipelineMetric', 'EventSample', 'EventSampleRequest',
        'AuditLog', 'AnomalyEvent',
        'NotificationChannel', 'AlertRule', 'WebhookEndpoint',
        'Environment', 'VectorNode', 'Team', 'OrgMember',
        'OrganizationSettings', 'OrgAccessGrant',
        'ServiceAccount', 'BackupRecord', 'CostRecommendation',
        'StagedRollout', 'PromotionRequest', 'DeployRequest', 'GitSyncJob',
        'Template', 'VrlSnippet', 'SharedComponent', 'FilterPreset',
        'DashboardView', 'UserPreference', 'MigrationProject',
        'PipelineGroup', 'NodeGroup'
    ];
BEGIN
    -- Feature-detect TimescaleDB compressed hypertables; same skip rule
    -- as 20260516000001. See header comment for rationale.
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb')
      INTO has_timescaledb;

    IF has_timescaledb THEN
        SELECT COALESCE(array_agg(hypertable_name), ARRAY[]::text[])
          INTO compressed_hypertables
          FROM timescaledb_information.hypertables
         WHERE compression_enabled = true;
    END IF;

    FOREACH tbl IN ARRAY tenant_tables LOOP
        IF tbl = ANY(compressed_hypertables) THEN
            RAISE NOTICE 'phase5a-rls-strict: skipping % (TimescaleDB compressed hypertable; isolation enforced by withOrgTx)', tbl;
            CONTINUE;
        END IF;

        IF EXISTS (
            SELECT 1
              FROM information_schema.columns
             WHERE table_name   = tbl
               AND column_name  = 'organizationId'
        ) THEN
            -- Drop the permissive policy if present (idempotent across reruns).
            EXECUTE format(
                'DROP POLICY IF EXISTS %I ON %I;',
                tbl || '_org_isolation', tbl);

            -- Install strict policy.
            EXECUTE format($p$
                CREATE POLICY %I ON %I
                USING (
                    "organizationId" = current_setting('app.org_id', true)
                )
                WITH CHECK (
                    "organizationId" = current_setting('app.org_id', true)
                );
            $p$, tbl || '_org_isolation', tbl);

            RAISE NOTICE 'phase5a-rls-strict: strict policy installed on %', tbl;
        END IF;
    END LOOP;
END
$$;
