-- Phase 1: Organization tenancy primitive
-- Adds Organization, OrgMember, OrganizationSettings, PlatformOperator, OrgAccessGrant
-- and denormalises organizationId onto every tenant table.
--
-- Backfill strategy: seed the default org first, then add columns with that
-- id as the column default so existing rows are covered atomically.
-- FK constraints are added after the backfill is complete.

-- ─── New enums ─────────────────────────────────────────────────────────────

CREATE TYPE "OrgPlan" AS ENUM ('FREE', 'PRO', 'ENTERPRISE');
CREATE TYPE "OrgMemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "PlatformOperatorRole" AS ENUM ('SUPPORT', 'INFRA', 'BILLING', 'INCIDENT');

-- ─── Organization ──────────────────────────────────────────────────────────

CREATE TABLE "Organization" (
    "id"                TEXT NOT NULL,
    "slug"              TEXT NOT NULL,
    "name"              TEXT NOT NULL,
    "plan"              "OrgPlan" NOT NULL DEFAULT 'FREE',
    "region"            TEXT NOT NULL DEFAULT 'default',
    "dataKeyCiphertext" TEXT,
    "kmsKeyArn"         TEXT,
    "byokKeyArn"        TEXT,
    "suspendedAt"       TIMESTAMP(3),
    "deletedAt"         TIMESTAMP(3),
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- Seed the default org for self-hosted / OSS.
-- All existing rows will backfill to this id.
INSERT INTO "Organization" ("id", "slug", "name", "plan", "region", "updatedAt")
VALUES ('default', 'default', 'Default', 'FREE', 'default', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- ─── OrgMember ─────────────────────────────────────────────────────────────

CREATE TABLE "OrgMember" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role"           "OrgMemberRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrgMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrgMember_userId_organizationId_key" ON "OrgMember"("userId", "organizationId");
CREATE INDEX "OrgMember_userId_idx"         ON "OrgMember"("userId");
CREATE INDEX "OrgMember_organizationId_idx" ON "OrgMember"("organizationId");

ALTER TABLE "OrgMember"
    ADD CONSTRAINT "OrgMember_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "OrgMember_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: put every existing user into the default org as OWNER so self-hosted
-- admins retain full access. In Cloud the signup flow will set the correct role.
INSERT INTO "OrgMember" ("id", "userId", "organizationId", "role", "createdAt")
SELECT
    'om_' || "id",
    "id",
    'default',
    'OWNER',
    CURRENT_TIMESTAMP
FROM "User"
ON CONFLICT ("userId", "organizationId") DO NOTHING;

-- ─── OrganizationSettings ──────────────────────────────────────────────────

CREATE TABLE "OrganizationSettings" (
    "id"                          TEXT NOT NULL,
    "organizationId"              TEXT NOT NULL,

    -- OIDC
    "oidcIssuer"                  TEXT,
    "oidcClientId"                TEXT,
    "oidcClientSecret"            TEXT,
    "oidcDisplayName"             TEXT DEFAULT 'SSO',
    "oidcDefaultRole"             "Role" NOT NULL DEFAULT 'VIEWER',
    "oidcGroupSyncEnabled"        BOOLEAN NOT NULL DEFAULT false,
    "oidcGroupsScope"             TEXT DEFAULT 'groups',
    "oidcGroupsClaim"             TEXT DEFAULT 'groups',
    "oidcAdminGroups"             TEXT,
    "oidcEditorGroups"            TEXT,
    "oidcTokenEndpointAuthMethod" TEXT DEFAULT 'client_secret_post',
    "oidcTeamMappings"            TEXT,
    "oidcDefaultTeamId"           TEXT,

    -- Fleet tuning
    "fleetPollIntervalMs"     INTEGER NOT NULL DEFAULT 15000,
    "fleetUnhealthyThreshold" INTEGER NOT NULL DEFAULT 3,
    "metricsRetentionDays"    INTEGER NOT NULL DEFAULT 7,
    "logsRetentionDays"       INTEGER NOT NULL DEFAULT 3,

    -- Anomaly detection
    "anomalyBaselineWindowDays"    INTEGER NOT NULL DEFAULT 7,
    "anomalySigmaThreshold"        DOUBLE PRECISION NOT NULL DEFAULT 3,
    "anomalyMinStddevFloorPercent" INTEGER NOT NULL DEFAULT 5,
    "anomalyDedupWindowHours"      INTEGER NOT NULL DEFAULT 4,
    "anomalyEnabledMetrics"        TEXT NOT NULL DEFAULT 'eventsIn,errorsTotal,latencyMeanMs',

    -- Backup
    "backupEnabled"        BOOLEAN NOT NULL DEFAULT false,
    "backupCron"           TEXT NOT NULL DEFAULT '0 2 * * *',
    "backupRetentionCount" INTEGER NOT NULL DEFAULT 7,
    "lastBackupAt"         TIMESTAMP(3),
    "lastBackupStatus"     TEXT,
    "lastBackupError"      TEXT,

    -- S3 remote storage
    "backupStorageBackend" TEXT NOT NULL DEFAULT 'local',
    "s3Bucket"             TEXT,
    "s3Region"             TEXT DEFAULT 'us-east-1',
    "s3Prefix"             TEXT,
    "s3AccessKeyId"        TEXT,
    "s3SecretAccessKey"    TEXT,
    "s3Endpoint"           TEXT,

    -- SCIM
    "scimEnabled"     BOOLEAN NOT NULL DEFAULT false,
    "scimBearerToken" TEXT,

    -- Telemetry
    "telemetryEnabled"    BOOLEAN NOT NULL DEFAULT false,
    "telemetryInstanceId" TEXT,
    "telemetryEnabledAt"  TIMESTAMP(3),

    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationSettings_organizationId_key" ON "OrganizationSettings"("organizationId");

ALTER TABLE "OrganizationSettings"
    ADD CONSTRAINT "OrganizationSettings_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: copy current SystemSettings values into the default org's settings.
-- Handles the case where SystemSettings row may not exist yet (fresh installs).
INSERT INTO "OrganizationSettings" (
    "id", "organizationId",
    "oidcIssuer", "oidcClientId", "oidcClientSecret", "oidcDisplayName",
    "oidcDefaultRole", "oidcGroupSyncEnabled", "oidcGroupsScope", "oidcGroupsClaim",
    "oidcAdminGroups", "oidcEditorGroups", "oidcTokenEndpointAuthMethod",
    "oidcTeamMappings", "oidcDefaultTeamId",
    "fleetPollIntervalMs", "fleetUnhealthyThreshold",
    "metricsRetentionDays", "logsRetentionDays",
    "anomalyBaselineWindowDays", "anomalySigmaThreshold",
    "anomalyMinStddevFloorPercent", "anomalyDedupWindowHours", "anomalyEnabledMetrics",
    "backupEnabled", "backupCron", "backupRetentionCount",
    "lastBackupAt", "lastBackupStatus", "lastBackupError",
    "backupStorageBackend", "s3Bucket", "s3Region", "s3Prefix",
    "s3AccessKeyId", "s3SecretAccessKey", "s3Endpoint",
    "scimEnabled", "scimBearerToken",
    "telemetryEnabled", "telemetryInstanceId", "telemetryEnabledAt",
    "updatedAt"
)
SELECT
    'os_default', 'default',
    "oidcIssuer", "oidcClientId", "oidcClientSecret", "oidcDisplayName",
    "oidcDefaultRole", "oidcGroupSyncEnabled", "oidcGroupsScope", "oidcGroupsClaim",
    "oidcAdminGroups", "oidcEditorGroups", "oidcTokenEndpointAuthMethod",
    "oidcTeamMappings", "oidcDefaultTeamId",
    "fleetPollIntervalMs", "fleetUnhealthyThreshold",
    "metricsRetentionDays", "logsRetentionDays",
    "anomalyBaselineWindowDays", "anomalySigmaThreshold",
    "anomalyMinStddevFloorPercent", "anomalyDedupWindowHours", "anomalyEnabledMetrics",
    "backupEnabled", "backupCron", "backupRetentionCount",
    "lastBackupAt", "lastBackupStatus", "lastBackupError",
    "backupStorageBackend", "s3Bucket", "s3Region", "s3Prefix",
    "s3AccessKeyId", "s3SecretAccessKey", "s3Endpoint",
    "scimEnabled", "scimBearerToken",
    "telemetryEnabled", "telemetryInstanceId", "telemetryEnabledAt",
    CURRENT_TIMESTAMP
FROM "SystemSettings"
WHERE "id" = 'singleton'
ON CONFLICT ("organizationId") DO NOTHING;

-- If no SystemSettings row exists (fresh install), insert defaults.
INSERT INTO "OrganizationSettings" ("id", "organizationId", "updatedAt")
VALUES ('os_default', 'default', CURRENT_TIMESTAMP)
ON CONFLICT ("organizationId") DO NOTHING;

-- ─── PlatformOperator ──────────────────────────────────────────────────────

CREATE TABLE "PlatformOperator" (
    "id"        TEXT NOT NULL,
    "email"     TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "role"      "PlatformOperatorRole" NOT NULL DEFAULT 'SUPPORT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformOperator_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformOperator_email_key" ON "PlatformOperator"("email");

-- ─── OrgAccessGrant ────────────────────────────────────────────────────────

CREATE TABLE "OrgAccessGrant" (
    "id"                        TEXT NOT NULL,
    "organizationId"            TEXT NOT NULL,
    "operatorId"                TEXT NOT NULL,
    "reason"                    TEXT NOT NULL,
    "approvedByCustomerAdminId" TEXT,
    "kmsGrantToken"             TEXT,
    "expiresAt"                 TIMESTAMP(3) NOT NULL,
    "revokedAt"                 TIMESTAMP(3),
    "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrgAccessGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrgAccessGrant_organizationId_idx" ON "OrgAccessGrant"("organizationId");
CREATE INDEX "OrgAccessGrant_operatorId_idx"     ON "OrgAccessGrant"("operatorId");
CREATE INDEX "OrgAccessGrant_expiresAt_idx"      ON "OrgAccessGrant"("expiresAt");

ALTER TABLE "OrgAccessGrant"
    ADD CONSTRAINT "OrgAccessGrant_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "OrgAccessGrant_operatorId_fkey"
        FOREIGN KEY ("operatorId") REFERENCES "PlatformOperator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Add organizationId to tenant tables ───────────────────────────────────
-- Pattern: add column with default 'default', backfill (covers all existing rows
-- via the default), make NOT NULL, add FK + index.
-- Each ALTER is a separate statement so a failure is easy to identify.

-- Team
ALTER TABLE "Team" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "Team_organizationId_idx" ON "Team"("organizationId");
ALTER TABLE "Team"
    ADD CONSTRAINT "Team_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- Environment
ALTER TABLE "Environment" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "Environment_organizationId_idx" ON "Environment"("organizationId");
ALTER TABLE "Environment"
    ADD CONSTRAINT "Environment_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- VectorNode
ALTER TABLE "VectorNode" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "VectorNode_organizationId_idx" ON "VectorNode"("organizationId");
ALTER TABLE "VectorNode"
    ADD CONSTRAINT "VectorNode_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- Pipeline
ALTER TABLE "Pipeline" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "Pipeline_organizationId_idx" ON "Pipeline"("organizationId");
ALTER TABLE "Pipeline"
    ADD CONSTRAINT "Pipeline_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- PipelineVersion
ALTER TABLE "PipelineVersion" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "PipelineVersion_organizationId_idx" ON "PipelineVersion"("organizationId");
ALTER TABLE "PipelineVersion"
    ADD CONSTRAINT "PipelineVersion_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- AlertRule
ALTER TABLE "AlertRule" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "AlertRule_organizationId_idx" ON "AlertRule"("organizationId");
ALTER TABLE "AlertRule"
    ADD CONSTRAINT "AlertRule_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- NotificationChannel
ALTER TABLE "NotificationChannel" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "NotificationChannel_organizationId_idx" ON "NotificationChannel"("organizationId");
ALTER TABLE "NotificationChannel"
    ADD CONSTRAINT "NotificationChannel_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- WebhookEndpoint
ALTER TABLE "WebhookEndpoint" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "WebhookEndpoint_organizationId_idx" ON "WebhookEndpoint"("organizationId");
ALTER TABLE "WebhookEndpoint"
    ADD CONSTRAINT "WebhookEndpoint_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- ServiceAccount
ALTER TABLE "ServiceAccount" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "ServiceAccount_organizationId_idx" ON "ServiceAccount"("organizationId");
ALTER TABLE "ServiceAccount"
    ADD CONSTRAINT "ServiceAccount_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- AuditLog
ALTER TABLE "AuditLog" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");
ALTER TABLE "AuditLog"
    ADD CONSTRAINT "AuditLog_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- BackupRecord
ALTER TABLE "BackupRecord" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "BackupRecord_organizationId_idx" ON "BackupRecord"("organizationId");
ALTER TABLE "BackupRecord"
    ADD CONSTRAINT "BackupRecord_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- AnomalyEvent
ALTER TABLE "AnomalyEvent" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
-- Note: AnomalyEvent already has @@index([environmentId]) etc; new index added below
CREATE INDEX "AnomalyEvent_organizationId_idx" ON "AnomalyEvent"("organizationId");
ALTER TABLE "AnomalyEvent"
    ADD CONSTRAINT "AnomalyEvent_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- MigrationProject
ALTER TABLE "MigrationProject" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "MigrationProject_organizationId_idx" ON "MigrationProject"("organizationId");
ALTER TABLE "MigrationProject"
    ADD CONSTRAINT "MigrationProject_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- EventSampleRequest
ALTER TABLE "EventSampleRequest" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "EventSampleRequest_organizationId_idx" ON "EventSampleRequest"("organizationId");
ALTER TABLE "EventSampleRequest"
    ADD CONSTRAINT "EventSampleRequest_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- EventSample
ALTER TABLE "EventSample" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "EventSample_organizationId_idx" ON "EventSample"("organizationId");
ALTER TABLE "EventSample"
    ADD CONSTRAINT "EventSample_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- PipelineLog
ALTER TABLE "PipelineLog" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "PipelineLog_organizationId_idx" ON "PipelineLog"("organizationId");
ALTER TABLE "PipelineLog"
    ADD CONSTRAINT "PipelineLog_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- NodeMetric
ALTER TABLE "NodeMetric" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "NodeMetric_organizationId_idx" ON "NodeMetric"("organizationId");
ALTER TABLE "NodeMetric"
    ADD CONSTRAINT "NodeMetric_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- PipelineMetric
ALTER TABLE "PipelineMetric" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "PipelineMetric_organizationId_idx" ON "PipelineMetric"("organizationId");
ALTER TABLE "PipelineMetric"
    ADD CONSTRAINT "PipelineMetric_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- CostRecommendation
ALTER TABLE "CostRecommendation" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "CostRecommendation_organizationId_idx" ON "CostRecommendation"("organizationId");
ALTER TABLE "CostRecommendation"
    ADD CONSTRAINT "CostRecommendation_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- StagedRollout
ALTER TABLE "StagedRollout" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "StagedRollout_organizationId_idx" ON "StagedRollout"("organizationId");
ALTER TABLE "StagedRollout"
    ADD CONSTRAINT "StagedRollout_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- PromotionRequest
ALTER TABLE "PromotionRequest" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "PromotionRequest_organizationId_idx" ON "PromotionRequest"("organizationId");
ALTER TABLE "PromotionRequest"
    ADD CONSTRAINT "PromotionRequest_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- DeployRequest
ALTER TABLE "DeployRequest" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "DeployRequest_organizationId_idx" ON "DeployRequest"("organizationId");
ALTER TABLE "DeployRequest"
    ADD CONSTRAINT "DeployRequest_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- GitSyncJob
ALTER TABLE "GitSyncJob" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "GitSyncJob_organizationId_idx" ON "GitSyncJob"("organizationId");
ALTER TABLE "GitSyncJob"
    ADD CONSTRAINT "GitSyncJob_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- Template
ALTER TABLE "Template" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "Template_organizationId_idx" ON "Template"("organizationId");
ALTER TABLE "Template"
    ADD CONSTRAINT "Template_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- VrlSnippet
ALTER TABLE "VrlSnippet" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "VrlSnippet_organizationId_idx" ON "VrlSnippet"("organizationId");
ALTER TABLE "VrlSnippet"
    ADD CONSTRAINT "VrlSnippet_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- SharedComponent
ALTER TABLE "SharedComponent" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "SharedComponent_organizationId_idx" ON "SharedComponent"("organizationId");
ALTER TABLE "SharedComponent"
    ADD CONSTRAINT "SharedComponent_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- FilterPreset
ALTER TABLE "FilterPreset" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "FilterPreset_organizationId_idx" ON "FilterPreset"("organizationId");
ALTER TABLE "FilterPreset"
    ADD CONSTRAINT "FilterPreset_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- DashboardView
ALTER TABLE "DashboardView" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "DashboardView_organizationId_idx" ON "DashboardView"("organizationId");
ALTER TABLE "DashboardView"
    ADD CONSTRAINT "DashboardView_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;

-- UserPreference
ALTER TABLE "UserPreference" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "UserPreference_organizationId_idx" ON "UserPreference"("organizationId");
ALTER TABLE "UserPreference"
    ADD CONSTRAINT "UserPreference_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON UPDATE CASCADE;
