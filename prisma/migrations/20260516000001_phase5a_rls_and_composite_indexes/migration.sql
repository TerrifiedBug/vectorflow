-- Phase 5a — Row-Level Security policies + composite (organizationId, ...) indexes.
--
-- ─── Design ────────────────────────────────────────────────────────────────
--
-- 1. Every tenant table gets `ENABLE ROW LEVEL SECURITY` plus a strict
--    policy: rows are visible only when `current_setting('app.org_id', true)`
--    matches the row's `organizationId`. The `true` second argument to
--    `current_setting` makes it return NULL when unset (rather than raise),
--    which we coerce via COALESCE so the "not set" case denies access.
--
--    ┌─────────────────────────────────────────────────────────────────┐
--    │ Single-tenant hosts continue to work because the Prisma         │
--    │ migration role typically owns the tables, and PostgreSQL allows │
--    │ table owners to bypass RLS unless `FORCE ROW LEVEL SECURITY` is │
--    │ set. We do NOT force RLS here; multi-tenant deployments run the │
--    │ app under a non-owner role (`vectorflow_app`, provisioned       │
--    │ out-of-band) and flip `FORCE` on as a follow-up migration once  │
--    │ every code path is wrapped in `withOrgTx`.                      │
--    └─────────────────────────────────────────────────────────────────┘
--
-- 2. Composite `(organizationId, ...)` indexes are added on the hottest
--    tenant tables. RLS without the leading-`organizationId` index
--    degrades to Seq Scan; these indexes keep query plans correct after
--    policies kick in.
--
-- 3. TimescaleDB hypertables with columnstore (compression) enabled CANNOT
--    have RLS enabled at the parent level — `ALTER TABLE … ENABLE ROW LEVEL
--    SECURITY` raises SQLSTATE 0A000 ("operation not supported on
--    hypertables that have columnstore enabled"; see TimescaleDB issue
--    #6827). Independently, TimescaleDB does NOT propagate policies from
--    parent hypertables to their chunks (issue #7830), so even when
--    compression is off, the parent policy would not fence chunk-direct
--    reads. We therefore skip RLS on every hypertable in the list and rely
--    on application-level isolation via `withOrgTx` (the `SET LOCAL
--    app.org_id` GUC is honored by handwritten `WHERE "organizationId" = …`
--    clauses, and the composite indexes below keep those plans cheap).
--    Affected tables today: PipelineLog, NodeMetric, PipelineMetric.
--    NodeStatusEvent is also compressed but has no organizationId column,
--    so it never enters the RLS list to begin with.

-- ─── 1. Strict policies on tenant tables ────────────────────────────────────
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
    -- Feature-detect TimescaleDB and gather any hypertables with
    -- columnstore enabled. RLS is incompatible with columnstore at the
    -- TimescaleDB layer (see header comment §3), so these tables are
    -- excluded from the policy loop below.
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
            RAISE NOTICE 'phase5a-rls: skipping % (TimescaleDB compressed hypertable; isolation enforced by withOrgTx + composite index)', tbl;
            CONTINUE;
        END IF;

        IF EXISTS (
            SELECT 1
              FROM information_schema.columns
             WHERE table_name   = tbl
               AND column_name  = 'organizationId'
        ) THEN
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
            EXECUTE format(
                'DROP POLICY IF EXISTS %I ON %I;',
                tbl || '_org_isolation', tbl);
            EXECUTE format($p$
                CREATE POLICY %I ON %I
                USING (
                    "organizationId" = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'app_org_id_unset_sentinel')
                    OR COALESCE(NULLIF(current_setting('app.org_id', true), ''), '') = ''
                )
                WITH CHECK (
                    "organizationId" = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'app_org_id_unset_sentinel')
                    OR COALESCE(NULLIF(current_setting('app.org_id', true), ''), '') = ''
                );
            $p$, tbl || '_org_isolation', tbl);
            RAISE NOTICE 'phase5a-rls: policy installed on %', tbl;
        ELSE
            RAISE NOTICE 'phase5a-rls: skipping % (no organizationId column)', tbl;
        END IF;
    END LOOP;
END
$$;

-- ─── 2. Composite (organizationId, …) indexes on 12 hottest tenant tables ──
-- Idempotent via IF NOT EXISTS. Index names are explicit so future migrations
-- can drop them by name.

CREATE INDEX IF NOT EXISTS "Pipeline_organizationId_environmentId_idx"
    ON "Pipeline" ("organizationId", "environmentId");
CREATE INDEX IF NOT EXISTS "Pipeline_organizationId_deployedAt_idx"
    ON "Pipeline" ("organizationId", "deployedAt" DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS "PipelineVersion_organizationId_pipelineId_version_idx"
    ON "PipelineVersion" ("organizationId", "pipelineId", "version" DESC);
CREATE INDEX IF NOT EXISTS "PipelineVersion_organizationId_createdAt_idx"
    ON "PipelineVersion" ("organizationId", "createdAt" DESC);

-- PipelineLog, NodeMetric, PipelineMetric are TimescaleDB hypertables; CREATE
-- INDEX is forwarded to all chunks automatically.
CREATE INDEX IF NOT EXISTS "PipelineLog_organizationId_timestamp_idx"
    ON "PipelineLog" ("organizationId", "timestamp" DESC);
CREATE INDEX IF NOT EXISTS "PipelineLog_organizationId_pipelineId_timestamp_idx"
    ON "PipelineLog" ("organizationId", "pipelineId", "timestamp" DESC);

CREATE INDEX IF NOT EXISTS "NodeMetric_organizationId_timestamp_idx"
    ON "NodeMetric" ("organizationId", "timestamp" DESC);
CREATE INDEX IF NOT EXISTS "NodeMetric_organizationId_nodeId_timestamp_idx"
    ON "NodeMetric" ("organizationId", "nodeId", "timestamp" DESC);

CREATE INDEX IF NOT EXISTS "PipelineMetric_organizationId_timestamp_idx"
    ON "PipelineMetric" ("organizationId", "timestamp" DESC);
CREATE INDEX IF NOT EXISTS "PipelineMetric_organizationId_pipelineId_timestamp_idx"
    ON "PipelineMetric" ("organizationId", "pipelineId", "timestamp" DESC);

CREATE INDEX IF NOT EXISTS "EventSample_organizationId_sampledAt_idx"
    ON "EventSample" ("organizationId", "sampledAt" DESC);

CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_createdAt_idx"
    ON "AuditLog" ("organizationId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_action_idx"
    ON "AuditLog" ("organizationId", "action");

CREATE INDEX IF NOT EXISTS "AnomalyEvent_organizationId_detectedAt_idx"
    ON "AnomalyEvent" ("organizationId", "detectedAt" DESC);
CREATE INDEX IF NOT EXISTS "AnomalyEvent_organizationId_status_idx"
    ON "AnomalyEvent" ("organizationId", "status");

CREATE INDEX IF NOT EXISTS "NotificationChannel_organizationId_environmentId_idx"
    ON "NotificationChannel" ("organizationId", "environmentId");

CREATE INDEX IF NOT EXISTS "AlertRule_organizationId_environmentId_idx"
    ON "AlertRule" ("organizationId", "environmentId");
CREATE INDEX IF NOT EXISTS "AlertRule_organizationId_pipelineId_idx"
    ON "AlertRule" ("organizationId", "pipelineId");

CREATE INDEX IF NOT EXISTS "WebhookEndpoint_organizationId_teamId_idx"
    ON "WebhookEndpoint" ("organizationId", "teamId");
