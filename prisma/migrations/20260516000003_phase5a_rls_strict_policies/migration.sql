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
-- ─── Rollback ──────────────────────────────────────────────────────────────
-- If we ever need to revert: re-create the previous CREATE POLICY shape on
-- each table after DROP POLICY. The full text lived in the body of
-- migration 20260516000001.

DO $$
DECLARE
    tbl text;
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
    FOREACH tbl IN ARRAY tenant_tables LOOP
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
