-- Org hard-delete cascade.
--
-- Deleting an Organization relies on ON DELETE CASCADE to wipe every tenant
-- child row in a single `DELETE FROM "Organization"` (prisma.organization.delete).
-- The data-plane `organizationId` FKs were created ON DELETE NO ACTION, so that
-- delete fails with a foreign-key violation on any org carrying real data. This
-- migration completes the cascade closure so an org can be hard-deleted cleanly.
-- (vectorflow-cloud runs this on a schedule; the cascade itself is generic
-- referential integrity that applies to every install.)
--
-- Scope (cascade closure from Organization covers every org-scoped table):
--   * 30 data-plane `*.organizationId -> Organization` FKs set to CASCADE. 28 were
--     created NO ACTION by add_organization_tenancy; WebAuthnChallenge and ActiveTap
--     carried only the RLS `organizationId` column (no FK at all, see
--     tenancy_belts_and_braces), so they get a CASCADE FK here -- without it an org
--     hard-delete leaves their transient rows behind (verified against the live FK
--     graph 2026-05-31).
--   * 8 intra-tree FKs that would otherwise block the cascade (a child RESTRICT
--     pointing at a parent that is itself cascade-deleted): TeamMember.teamId,
--     {Pipeline,VectorNode,SharedComponent,PipelineGroup,NodeGroup,StagedRollout}
--     .environmentId, and StagedRollout.canaryVersionId (NOT NULL, so SET NULL is
--     impossible -> CASCADE; a rollout is meaningless without its canary version).
--
-- Intentionally NOT changed:
--   * AuditLog.organizationId stays NO ACTION -- the append-only audit chain must
--     not vanish on a stray org delete; a hard-delete is expected to archive +
--     delete audit rows explicitly first, so NO ACTION is the intended guard.
--   * OperatorApprovalRequest.organizationId (cloud-only) stays SET NULL --
--     operator approval history deliberately survives tenant deletion.
--   * `*.createdById -> User` FKs are org-independent (users outlive orgs).

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('Team','organizationId','Organization'),
    ('Environment','organizationId','Organization'),
    ('VectorNode','organizationId','Organization'),
    ('Pipeline','organizationId','Organization'),
    ('PipelineVersion','organizationId','Organization'),
    ('Template','organizationId','Organization'),
    ('PipelineMetric','organizationId','Organization'),
    ('NodeMetric','organizationId','Organization'),
    ('PipelineLog','organizationId','Organization'),
    ('EventSampleRequest','organizationId','Organization'),
    ('EventSample','organizationId','Organization'),
    ('VrlSnippet','organizationId','Organization'),
    ('AlertRule','organizationId','Organization'),
    ('DashboardView','organizationId','Organization'),
    ('DeployRequest','organizationId','Organization'),
    ('NotificationChannel','organizationId','Organization'),
    ('ServiceAccount','organizationId','Organization'),
    ('UserPreference','organizationId','Organization'),
    ('SharedComponent','organizationId','Organization'),
    ('StagedRollout','organizationId','Organization'),
    ('PromotionRequest','organizationId','Organization'),
    ('BackupRecord','organizationId','Organization'),
    ('FilterPreset','organizationId','Organization'),
    ('GitSyncJob','organizationId','Organization'),
    ('AnomalyEvent','organizationId','Organization'),
    ('CostRecommendation','organizationId','Organization'),
    ('MigrationProject','organizationId','Organization'),
    ('WebhookEndpoint','organizationId','Organization'),
    ('WebAuthnChallenge','organizationId','Organization'),
    ('ActiveTap','organizationId','Organization'),
    ('TeamMember','teamId','Team'),
    ('Pipeline','environmentId','Environment'),
    ('VectorNode','environmentId','Environment'),
    ('SharedComponent','environmentId','Environment'),
    ('PipelineGroup','environmentId','Environment'),
    ('NodeGroup','environmentId','Environment'),
    ('StagedRollout','environmentId','Environment'),
    ('StagedRollout','canaryVersionId','PipelineVersion')
  ) AS t(tbl, col, ref)
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', r.tbl, r.tbl || '_' || r.col || '_fkey');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I("id") ON DELETE CASCADE ON UPDATE CASCADE',
      r.tbl, r.tbl || '_' || r.col || '_fkey', r.col, r.ref
    );
  END LOOP;
END $$;
