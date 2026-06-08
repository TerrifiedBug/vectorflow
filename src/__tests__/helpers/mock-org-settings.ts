/**
 * Default OrganizationSettings mock for unit tests.
 *
 * Tests that exercise code calling getOrgSettings() need to stub
 * prisma.organizationSettings.findUnique to return this (or an override).
 * Tests that need specific non-default values should spread and override.
 *
 * Usage:
 *   prismaMock.organizationSettings.findUnique.mockResolvedValue(mockOrgSettings());
 *   prismaMock.organizationSettings.create.mockResolvedValue(mockOrgSettings());
 *
 * With override:
 *   prismaMock.organizationSettings.findUnique.mockResolvedValue(
 *     mockOrgSettings({ backupStorageBackend: "s3", s3Bucket: "my-bucket" })
 *   );
 */

export function mockOrgSettings(
  overrides: Partial<{
    id: string;
    organizationId: string;
    oidcIssuer: string | null;
    oidcClientId: string | null;
    oidcClientSecret: string | null;
    oidcDisplayName: string | null;
    oidcDefaultRole: "VIEWER" | "EDITOR" | "ADMIN";
    oidcGroupSyncEnabled: boolean;
    oidcGroupsScope: string | null;
    oidcGroupsClaim: string | null;
    oidcAdminGroups: string | null;
    oidcEditorGroups: string | null;
    oidcTokenEndpointAuthMethod: string | null;
    oidcTeamMappings: string | null;
    oidcDefaultTeamId: string | null;
    samlEnabled: boolean;
    samlIdpEntityId: string | null;
    samlIdpSsoUrl: string | null;
    samlIdpCert: string | null;
    samlEnforced: boolean;
    samlGroupAttribute: string | null;
    fleetPollIntervalMs: number;
    fleetUnhealthyThreshold: number;
    metricsRetentionDays: number;
    metricsRollupRetentionDays: number;
    logsRetentionDays: number;
    anomalyBaselineWindowDays: number;
    anomalySigmaThreshold: number;
    anomalyMinStddevFloorPercent: number;
    anomalyDedupWindowHours: number;
    anomalyEnabledMetrics: string;
    backupEnabled: boolean;
    backupCron: string;
    backupRetentionCount: number;
    lastBackupAt: Date | null;
    lastBackupStatus: string | null;
    lastBackupError: string | null;
    backupStorageBackend: string;
    s3Bucket: string | null;
    s3Region: string | null;
    s3Prefix: string | null;
    s3AccessKeyId: string | null;
    s3SecretAccessKey: string | null;
    s3Endpoint: string | null;
    scimEnabled: boolean;
    scimBearerToken: string | null;
    telemetryEnabled: boolean;
    telemetryInstanceId: string | null;
    telemetryEnabledAt: Date | null;
    aiBaseUrlOptIn: boolean;
    subprocessorNoticeEmail: string | null;
    allowSharedIdpHostnames: boolean;
    updatedAt: Date;
  }> = {},
) {
  return {
    id: "os_default",
    organizationId: "default",
    oidcIssuer: null,
    oidcClientId: null,
    oidcClientSecret: null,
    oidcDisplayName: "SSO",
    oidcDefaultRole: "VIEWER" as const,
    oidcGroupSyncEnabled: false,
    oidcGroupsScope: "groups",
    oidcGroupsClaim: "groups",
    oidcAdminGroups: null,
    oidcEditorGroups: null,
    oidcTokenEndpointAuthMethod: "client_secret_post",
    oidcTeamMappings: null,
    oidcDefaultTeamId: null,
    samlEnabled: false,
    samlIdpEntityId: null,
    samlIdpSsoUrl: null,
    samlIdpCert: null,
    samlEnforced: false,
    samlGroupAttribute: null,
    fleetPollIntervalMs: 15000,
    fleetUnhealthyThreshold: 3,
    metricsRetentionDays: 7,
    metricsRollupRetentionDays: 90,
    logsRetentionDays: 3,
    anomalyBaselineWindowDays: 7,
    anomalySigmaThreshold: 3,
    anomalyMinStddevFloorPercent: 5,
    anomalyDedupWindowHours: 4,
    anomalyEnabledMetrics: "eventsIn,errorsTotal,latencyMeanMs",
    backupEnabled: false,
    backupCron: "0 2 * * *",
    backupRetentionCount: 7,
    lastBackupAt: null,
    lastBackupStatus: null,
    lastBackupError: null,
    backupStorageBackend: "local",
    s3Bucket: null,
    s3Region: "us-east-1",
    s3Prefix: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Endpoint: null,
    scimEnabled: false,
    scimBearerToken: null,
    telemetryEnabled: false,
    telemetryInstanceId: null,
    telemetryEnabledAt: null,
    aiBaseUrlOptIn: false,
    subprocessorNoticeEmail: null,
    allowSharedIdpHostnames: false,
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}
