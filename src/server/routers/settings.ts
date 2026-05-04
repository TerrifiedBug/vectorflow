import { z } from "zod";
import crypto from "crypto";
import { TRPCError } from "@trpc/server";
import { S3Client, HeadBucketCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { router, protectedProcedure, requireSuperAdmin, denyInDemo } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/server/services/crypto";
import { withAudit } from "@/server/middleware/audit";
import { invalidateAuthCache } from "@/auth";
import { checkServerVersion, checkAgentVersion, checkDevAgentVersion } from "@/server/services/version-check";
import {
  createBackup,
  listBackups,
  deleteBackup,
  restoreFromBackup,
  runRetentionCleanup,
  previewBackup,
} from "@/server/services/backup";
import { rescheduleBackup, isValidCron } from "@/server/services/backup-scheduler";
import { validatePublicUrl } from "@/server/services/url-validation";

const SETTINGS_ID = "singleton";

/** Mask a secret string, showing only the last 4 characters */
function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 4) return "****";
  return "****" + value.slice(-4);
}

async function getOrCreateSettings() {
  let settings = await prisma.systemSettings.findUnique({
    where: { id: SETTINGS_ID },
  });
  if (!settings) {
    settings = await prisma.systemSettings.create({
      data: { id: SETTINGS_ID },
    });
  }
  return settings;
}

export const settingsRouter = router({
  get: protectedProcedure
    .use(requireSuperAdmin())
    .query(async () => {
      const settings = await getOrCreateSettings();

      // Decrypt clientSecret for masking
      let maskedClientSecret: string | null = null;
      if (settings.oidcClientSecret) {
        try {
          const decrypted = decrypt(settings.oidcClientSecret);
          maskedClientSecret = maskSecret(decrypted);
        } catch {
          maskedClientSecret = "****";
        }
      }

      return {
        oidcIssuer: settings.oidcIssuer,
        oidcClientId: settings.oidcClientId,
        oidcClientSecret: maskedClientSecret,
        oidcDisplayName: settings.oidcDisplayName,
        oidcDefaultRole: settings.oidcDefaultRole,
        oidcGroupSyncEnabled: settings.oidcGroupSyncEnabled,
        oidcGroupsScope: settings.oidcGroupsScope,
        oidcGroupsClaim: settings.oidcGroupsClaim,
        oidcAdminGroups: settings.oidcAdminGroups,
        oidcEditorGroups: settings.oidcEditorGroups,
        oidcTokenEndpointAuthMethod: settings.oidcTokenEndpointAuthMethod ?? "client_secret_post",
        oidcTeamMappings: (() => {
          try {
            return settings.oidcTeamMappings
              ? JSON.parse(settings.oidcTeamMappings) as Array<{group: string; teamId: string; role: string}>
              : [];
          } catch {
            return [];
          }
        })(),
        oidcDefaultTeamId: settings.oidcDefaultTeamId,
        fleetPollIntervalMs: settings.fleetPollIntervalMs,
        fleetUnhealthyThreshold: settings.fleetUnhealthyThreshold,
        metricsRetentionDays: settings.metricsRetentionDays,
        logsRetentionDays: settings.logsRetentionDays,
        backupEnabled: settings.backupEnabled,
        backupCron: settings.backupCron,
        backupRetentionCount: settings.backupRetentionCount,
        lastBackupAt: settings.lastBackupAt,
        lastBackupStatus: settings.lastBackupStatus,
        lastBackupError: settings.lastBackupError,
        backupStorageBackend: settings.backupStorageBackend,
        s3Bucket: settings.s3Bucket,
        s3Region: settings.s3Region,
        s3Prefix: settings.s3Prefix,
        s3AccessKeyId: settings.s3AccessKeyId,
        s3SecretAccessKey: (() => {
          if (!settings.s3SecretAccessKey) return null;
          try {
            return maskSecret(decrypt(settings.s3SecretAccessKey));
          } catch {
            return "****";
          }
        })(),
        s3Endpoint: settings.s3Endpoint,
        scimEnabled: settings.scimEnabled,
        scimTokenConfigured: !!settings.scimBearerToken,
        anomalyBaselineWindowDays: settings.anomalyBaselineWindowDays,
        anomalySigmaThreshold: settings.anomalySigmaThreshold,
        anomalyMinStddevFloorPercent: settings.anomalyMinStddevFloorPercent,
        anomalyDedupWindowHours: settings.anomalyDedupWindowHours,
        anomalyEnabledMetrics: settings.anomalyEnabledMetrics,
        updatedAt: settings.updatedAt,
      };
    }),

  updateOidc: protectedProcedure
    .use(denyInDemo())
    .use(requireSuperAdmin())
    .input(
      z.object({
        issuer: z.string().url().min(1),
        clientId: z.string().min(1),
        clientSecret: z.string().min(1),
        displayName: z.string().min(1).default("SSO"),
        tokenEndpointAuthMethod: z.enum(["client_secret_post", "client_secret_basic"]).default("client_secret_post"),
      })
    )
    .use(withAudit("settings.oidc_updated", "SystemSettings"))
    .mutation(async ({ input }) => {
      await getOrCreateSettings();

      const data: Record<string, unknown> = {
        oidcIssuer: input.issuer,
        oidcClientId: input.clientId,
        oidcDisplayName: input.displayName,
        oidcTokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
      };

      if (input.clientSecret !== "unchanged") {
        data.oidcClientSecret = encrypt(input.clientSecret);
      }

      const result = await prisma.systemSettings.update({
        where: { id: SETTINGS_ID },
        data,
      });
      invalidateAuthCache();
      return result;
    }),

  updateOidcRoleMapping: protectedProcedure
    .use(denyInDemo())
    .use(requireSuperAdmin())
    .input(
      z.object({
        defaultRole: z.enum(["VIEWER", "EDITOR", "ADMIN"]),
        groupsClaim: z.string().min(1).default("groups"),
        adminGroups: z.string().optional(),
        editorGroups: z.string().optional(),
      })
    )
    .use(withAudit("settings.oidc_role_mapping_updated", "SystemSettings"))
    .mutation(async ({ input }) => {
      await getOrCreateSettings();

      return prisma.systemSettings.update({
        where: { id: SETTINGS_ID },
        data: {
          oidcDefaultRole: input.defaultRole,
          oidcGroupsClaim: input.groupsClaim,
          oidcAdminGroups: input.adminGroups || null,
          oidcEditorGroups: input.editorGroups || null,
        },
      });
    }),

  updateOidcTeamMappings: protectedProcedure
    .use(denyInDemo())
    .use(requireSuperAdmin())
    .input(z.object({
      mappings: z.array(z.object({
        group: z.string().min(1),
        teamId: z.string(),
        role: z.enum(["VIEWER", "EDITOR", "ADMIN"]),
      })),
      defaultTeamId: z.string().optional(),
      defaultRole: z.enum(["VIEWER", "EDITOR", "ADMIN"]),
      groupSyncEnabled: z.boolean(),
      groupsScope: z.string(),
      groupsClaim: z.string().min(1),
    }))
    .use(withAudit("settings.oidc_team_mapping_updated", "SystemSettings"))
    .mutation(async ({ input }) => {
      await getOrCreateSettings();

      // Validate all teamIds exist
      if (input.mappings.length > 0) {
        const teamIds = [...new Set(input.mappings.map((m) => m.teamId))];
        const teams = await prisma.team.findMany({
          where: { id: { in: teamIds } },
          select: { id: true },
        });
        const foundIds = new Set(teams.map((t) => t.id));
        const missing = teamIds.filter((id) => !foundIds.has(id));
        if (missing.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Teams not found: ${missing.join(", ")}`,
          });
        }
      }

      if (input.defaultTeamId) {
        const team = await prisma.team.findUnique({ where: { id: input.defaultTeamId } });
        if (!team) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Default team not found" });
        }
      }

      const result = await prisma.systemSettings.update({
        where: { id: SETTINGS_ID },
        data: {
          oidcGroupSyncEnabled: input.groupSyncEnabled,
          oidcGroupsScope: input.groupsScope || null,
          oidcTeamMappings: JSON.stringify(input.mappings),
          oidcDefaultTeamId: input.defaultTeamId || null,
          oidcDefaultRole: input.defaultRole,
          oidcGroupsClaim: input.groupsClaim,
          // Clear legacy fields when saving new team mappings
          oidcAdminGroups: null,
          oidcEditorGroups: null,
        },
      });
      invalidateAuthCache();

      // In SCIM mode, reconcile all users who have ScimGroupMember records
      const scimSettings = await prisma.systemSettings.findUnique({
        where: { id: SETTINGS_ID },
        select: { scimEnabled: true },
      });
      if (scimSettings?.scimEnabled) {
        const { reconcileUserTeamMemberships, getScimGroupNamesForUser } =
          await import("@/server/services/group-mappings");

        const usersWithScimGroups = await prisma.scimGroupMember.findMany({
          select: { userId: true },
          distinct: ["userId"],
        });

        await prisma.$transaction(async (tx) => {
          for (const { userId } of usersWithScimGroups) {
            const groupNames = await getScimGroupNamesForUser(tx, userId);
            await reconcileUserTeamMemberships(tx, userId, groupNames);
          }
        });
      }

      return result;
    }),

  updateFleet: protectedProcedure
    .use(denyInDemo())
    .use(requireSuperAdmin())
    .input(
      z.object({
        pollIntervalMs: z.number().int().min(1000).max(300000),
        unhealthyThreshold: z.number().int().min(1).max(100),
        metricsRetentionDays: z.number().int().min(1).max(365).optional(),
        logsRetentionDays: z.number().int().min(1).max(30).optional(),
      })
    )
    .use(withAudit("settings.fleet_updated", "SystemSettings"))
    .mutation(async ({ input }) => {
      await getOrCreateSettings();

      return prisma.systemSettings.update({
        where: { id: SETTINGS_ID },
        data: {
          fleetPollIntervalMs: input.pollIntervalMs,
          fleetUnhealthyThreshold: input.unhealthyThreshold,
          ...(input.metricsRetentionDays !== undefined ? { metricsRetentionDays: input.metricsRetentionDays } : {}),
          ...(input.logsRetentionDays !== undefined ? { logsRetentionDays: input.logsRetentionDays } : {}),
        },
      });
    }),

  updateAnomalyConfig: protectedProcedure
    .use(denyInDemo())
    .use(requireSuperAdmin())
    .input(
      z.object({
        baselineWindowDays: z.number().int().min(1).max(30),
        sigmaThreshold: z.number().min(1.5).max(5),
        minStddevFloorPercent: z.number().int().min(1).max(25),
        dedupWindowHours: z.number().int().min(1).max(48),
        enabledMetrics: z.string().min(1),
      })
    )
    .use(withAudit("settings.anomaly_config_updated", "SystemSettings"))
    .mutation(async ({ input }) => {
      // Validate enabled metrics
      const validMetrics = new Set(["eventsIn", "errorsTotal", "latencyMeanMs"]);
      const metrics = input.enabledMetrics.split(",").map((s) => s.trim());
      const invalid = metrics.filter((m) => !validMetrics.has(m));
      if (invalid.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid metrics: ${invalid.join(", ")}`,
        });
      }
      if (metrics.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "At least one metric must be enabled",
        });
      }

      await getOrCreateSettings();

      const result = await prisma.systemSettings.update({
        where: { id: SETTINGS_ID },
        data: {
          anomalyBaselineWindowDays: input.baselineWindowDays,
          anomalySigmaThreshold: input.sigmaThreshold,
          anomalyMinStddevFloorPercent: input.minStddevFloorPercent,
          anomalyDedupWindowHours: input.dedupWindowHours,
          anomalyEnabledMetrics: input.enabledMetrics,
        },
      });

      // Bust the in-memory cache so the next poll picks up changes
      const { invalidateAnomalyConfigCache } = await import(
        "@/server/services/anomaly-detector"
      );
      invalidateAnomalyConfigCache();

      return result;
    }),

  testOidc: protectedProcedure
    .use(denyInDemo())
    .use(requireSuperAdmin())
    .input(
      z.object({
        issuer: z.string().url().min(1),
      })
    )
    .mutation(async ({ input }) => {
      await validatePublicUrl(input.issuer);
      const discoveryUrl = `${input.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;

      try {
        const response = await fetch(discoveryUrl, {
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `OIDC discovery endpoint returned ${response.status}: ${response.statusText}`,
          });
        }

        const data = await response.json();

        if (!data.issuer || !data.authorization_endpoint || !data.token_endpoint) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "OIDC discovery response is missing required fields (issuer, authorization_endpoint, token_endpoint)",
          });
        }

        return {
          success: true,
          issuer: data.issuer,
          authorizationEndpoint: data.authorization_endpoint,
          tokenEndpoint: data.token_endpoint,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Failed to connect to OIDC provider: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }),

  checkVersion: protectedProcedure
    .input(z.object({ force: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      const [server, agent, devAgent] = await Promise.all([
        checkServerVersion(input?.force),
        checkAgentVersion(input?.force),
        checkDevAgentVersion(input?.force),
      ]);
      return {
        server,
        agent,
        devAgent: {
          latestVersion: devAgent.latestVersion,
          checksums: devAgent.checksums,
          checkedAt: devAgent.checkedAt,
        },
      };
    }),

  // ─── Backup & Restore ─────────────────────────────────────────────────────

  createBackup: protectedProcedure
    .use(denyInDemo())
    .use(requireSuperAdmin())
    .use(withAudit("settings.backup_created", "SystemSettings"))
    .mutation(async () => {
      const metadata = await createBackup();
      await runRetentionCleanup();
      return metadata;
    }),

  listBackups: protectedProcedure
    .use(requireSuperAdmin())
    .query(async () => {
      return listBackups();
    }),

  previewBackup: protectedProcedure
    .use(denyInDemo())
    .use(requireSuperAdmin())
    .input(z.object({ filename: z.string().min(1) }))
    .query(async ({ input }) => {
      return previewBackup(input.filename);
    }),

  deleteBackup: protectedProcedure
    .use(denyInDemo())
    .use(requireSuperAdmin())
    .input(z.object({ filename: z.string().min(1) }))
    .use(withAudit("settings.backup_deleted", "SystemSettings"))
    .mutation(async ({ input }) => {
      await deleteBackup(input.filename);
      return { success: true };
    }),

  restoreBackup: protectedProcedure
    .use(denyInDemo())
    .use(requireSuperAdmin())
    .input(z.object({ filename: z.string().min(1) }))
    .use(withAudit("settings.backup_restored", "SystemSettings"))
    .mutation(async ({ input }) => {
      await restoreFromBackup(input.filename);
      return { success: true };
    }),

  updateBackupSchedule: protectedProcedure
    .use(denyInDemo())
    .use(requireSuperAdmin())
    .input(
      z.object({
        enabled: z.boolean(),
        cron: z.string().min(1),
        retentionCount: z.number().int().min(1).max(100),
      })
    )
    .use(withAudit("settings.backup_schedule_updated", "SystemSettings"))
    .mutation(async ({ input }) => {
      if (!isValidCron(input.cron)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid cron expression",
        });
      }

      await getOrCreateSettings();
      const result = await prisma.systemSettings.update({
        where: { id: SETTINGS_ID },
        data: {
          backupEnabled: input.enabled,
          backupCron: input.cron,
          backupRetentionCount: input.retentionCount,
        },
      });

      rescheduleBackup(input.enabled, input.cron);
      return result;
    }),

  testS3Connection: protectedProcedure
    .use(denyInDemo())
    .use(requireSuperAdmin())
    .input(z.object({
      bucket: z.string().min(1),
      region: z.string().min(1),
      prefix: z.string().optional().default(""),
      accessKeyId: z.string().min(1),
      secretAccessKey: z.string().min(1),
      endpoint: z.string().url().optional().or(z.literal("")),
    }))
    .mutation(async ({ input }) => {
      const client = new S3Client({
        region: input.region,
        credentials: {
          accessKeyId: input.accessKeyId,
          secretAccessKey: input.secretAccessKey,
        },
        ...(input.endpoint ? { endpoint: input.endpoint } : {}),
        forcePathStyle: !!input.endpoint,
      });

      const testKey = `${input.prefix ? input.prefix.replace(/\/$/, "") + "/" : ""}vf-conn-test-${Date.now()}`;

      try {
        await client.send(new HeadBucketCommand({ Bucket: input.bucket }));
        await client.send(new PutObjectCommand({ Bucket: input.bucket, Key: testKey, Body: "ok" }));
        await client.send(new DeleteObjectCommand({ Bucket: input.bucket, Key: testKey }));
        return { success: true as const };
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        if (name === "NoSuchBucket") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Bucket not found" });
        }
        if (name === "AccessDenied" || name === "AccessDeniedException") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied -- check credentials and bucket policy" });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `S3 connection failed: ${err instanceof Error ? err.message : "unknown"}`,
        });
      }
    }),

  updateStorageBackend: protectedProcedure
    .use(denyInDemo())
    .use(requireSuperAdmin())
    .input(z.object({
      backend: z.enum(["local", "s3"]),
      bucket: z.string().optional(),
      region: z.string().optional(),
      prefix: z.string().optional(),
      accessKeyId: z.string().optional(),
      secretAccessKey: z.string().optional(),
      endpoint: z.string().optional(),
    }))
    .use(withAudit("settings.storage_backend_updated", "SystemSettings"))
    .mutation(async ({ input }) => {
      await getOrCreateSettings();

      const data: Record<string, unknown> = {
        backupStorageBackend: input.backend,
      };

      if (input.backend === "s3") {
        if (input.bucket !== undefined) data.s3Bucket = input.bucket;
        if (input.region !== undefined) data.s3Region = input.region;
        if (input.prefix !== undefined) data.s3Prefix = input.prefix;
        if (input.accessKeyId !== undefined) data.s3AccessKeyId = input.accessKeyId;
        if (input.secretAccessKey && input.secretAccessKey !== "unchanged") {
          data.s3SecretAccessKey = encrypt(input.secretAccessKey);
        }
        if (input.endpoint !== undefined) data.s3Endpoint = input.endpoint || null;
      }
      // When switching to "local", keep S3 credentials per locked decision:
      // "Switching from S3 back to Local keeps credentials -- user may switch back"

      return prisma.systemSettings.update({
        where: { id: SETTINGS_ID },
        data,
      });
    }),

  // ─── SCIM Provisioning ────────────────────────────────────────────────────

  updateScim: protectedProcedure
    .use(denyInDemo())
    .use(requireSuperAdmin())
    .input(z.object({ enabled: z.boolean() }))
    .use(withAudit("settings.scim_updated", "SystemSettings"))
    .mutation(async ({ input }) => {
      await getOrCreateSettings();

      // If disabling, also clear the token
      const data: Record<string, unknown> = {
        scimEnabled: input.enabled,
      };
      if (!input.enabled) {
        data.scimBearerToken = null;
      }

      return prisma.systemSettings.update({
        where: { id: SETTINGS_ID },
        data,
      });
    }),

  generateScimToken: protectedProcedure
    .use(denyInDemo())
    .use(requireSuperAdmin())
    .use(withAudit("settings.scim_token_generated", "SystemSettings"))
    .mutation(async () => {
      await getOrCreateSettings();

      // Generate a secure random token
      const token = crypto.randomBytes(32).toString("hex");

      // Store encrypted — does not enable SCIM; admin must toggle via updateScim
      await prisma.systemSettings.update({
        where: { id: SETTINGS_ID },
        data: {
          scimBearerToken: encrypt(token),
        },
      });

      // Return the plaintext token (shown once to the user)
      return { token };
    }),

  // ─── Production Readiness ────────────────────────────────────────────────

  productionReadiness: protectedProcedure
    .use(requireSuperAdmin())
    .query(async () => {
      const checkedAt = new Date().toISOString();

      type SignalStatus = "ok" | "warn" | "error" | "unknown";
      type Signal = {
        id: string;
        label: string;
        status: SignalStatus;
        detail: string;
        href?: string;
      };

      // Database latency check runs first and independently so a DB outage
      // still produces a payload with database: error rather than a 500.
      let dbLatencyMs: number | null = null;
      let dbOk = false;
      try {
        const start = Date.now();
        await prisma.$queryRaw`SELECT 1`;
        dbLatencyMs = Date.now() - start;
        dbOk = true;
      } catch {
        dbOk = false;
      }

      // Config queries — wrapped so a DB outage degrades config signals to
      // "unknown" instead of throwing and suppressing the database signal.
      type NodeStatRow = { status: string; _count: { id: number } };
      let settings: Awaited<ReturnType<typeof getOrCreateSettings>> | null = null;
      let nodeStats: NodeStatRow[] = [];
      let webhookCount = 0;
      let auditPipeline: { isDraft: boolean; deployedAt: Date | null } | null = null;
      let configAvailable = false;
      try {
        [settings, nodeStats, webhookCount, auditPipeline] = await Promise.all([
          getOrCreateSettings(),
          prisma.vectorNode.groupBy({
            by: ["status"],
            _count: { id: true },
          }),
          prisma.webhookEndpoint.count({ where: { enabled: true } }),
          prisma.pipeline.findFirst({
            where: { isSystem: true },
            select: { isDraft: true, deployedAt: true },
          }),
        ]);
        configAvailable = true;
      } catch {
        configAvailable = false;
      }

      const totalNodes = nodeStats.reduce((sum, g) => sum + g._count.id, 0);
      const unhealthyNodes = nodeStats
        .filter((g) => g.status === "DEGRADED" || g.status === "UNREACHABLE" || g.status === "UNKNOWN")
        .reduce((sum, g) => sum + g._count.id, 0);

      const currentVersion = process.env.VF_VERSION ?? "dev";
      const latestVersion = settings?.latestServerRelease ?? null;
      const updateAvailable =
        latestVersion &&
        latestVersion !== currentVersion &&
        currentVersion !== "dev";

      const backupOk =
        !!settings?.backupEnabled &&
        !!settings?.lastBackupAt &&
        settings?.lastBackupStatus !== "failed" &&
        Date.now() - new Date(settings.lastBackupAt).getTime() < 48 * 60 * 60 * 1000;

      const auditShippingActive =
        !!auditPipeline && !auditPipeline.isDraft && !!auditPipeline.deployedAt;

      const signals: Signal[] = [
        // Database
        {
          id: "database",
          label: "Database",
          status: dbOk ? (dbLatencyMs !== null && dbLatencyMs < 200 ? "ok" : "warn") : "error",
          detail: dbOk
            ? `Connected — ${dbLatencyMs}ms`
            : "Database unreachable",
        },
        // Backups
        {
          id: "backup",
          label: "Backups",
          status: !configAvailable
            ? "unknown"
            : !settings?.backupEnabled
            ? "warn"
            : backupOk
            ? "ok"
            : settings?.lastBackupStatus === "failed"
            ? "error"
            : "warn",
          detail: !configAvailable
            ? "Could not read backup configuration"
            : !settings?.backupEnabled
            ? "Scheduled backups disabled"
            : settings?.lastBackupStatus === "failed"
            ? `Last backup failed: ${settings?.lastBackupError ?? "unknown error"}`
            : settings?.lastBackupAt
            ? `Last backup ${new Date(settings.lastBackupAt).toLocaleDateString()}`
            : "No backup recorded",
          href: "/settings/backup",
        },
        // Version
        {
          id: "version",
          label: "Server version",
          status: !configAvailable
            ? "unknown"
            : !latestVersion && currentVersion !== "dev"
            ? "unknown"
            : updateAvailable
            ? "warn"
            : "ok",
          detail: !configAvailable
            ? "Could not read version data"
            : updateAvailable
            ? `Update available: ${latestVersion}`
            : !latestVersion && currentVersion !== "dev"
            ? `v${currentVersion} — no release data fetched yet`
            : currentVersion === "dev"
            ? "Development build"
            : `v${currentVersion} is current`,
          href: "/settings/version",
        },
        // OIDC / Auth
        {
          id: "oidc",
          label: "SSO / OIDC",
          status: !configAvailable ? "unknown" : settings?.oidcIssuer ? "ok" : "warn",
          detail: !configAvailable
            ? "Could not read auth configuration"
            : settings?.oidcIssuer
            ? `Configured (${settings.oidcDisplayName ?? "SSO"})`
            : "No OIDC provider configured — using local auth only",
          href: "/settings/auth",
        },
        // SCIM
        {
          id: "scim",
          label: "SCIM provisioning",
          status: !configAvailable ? "unknown" : settings?.scimEnabled ? "ok" : "warn",
          detail: !configAvailable
            ? "Could not read SCIM configuration"
            : settings?.scimEnabled
            ? "Enabled"
            : "Disabled — user provisioning is manual",
          href: "/settings/scim",
        },
        // Fleet
        {
          id: "fleet",
          label: "Fleet",
          status: !configAvailable
            ? "unknown"
            : totalNodes === 0
            ? "warn"
            : unhealthyNodes > 0
            ? "warn"
            : "ok",
          detail: !configAvailable
            ? "Could not read fleet data"
            : totalNodes === 0
            ? "No nodes registered"
            : unhealthyNodes > 0
            ? `${unhealthyNodes} of ${totalNodes} node${totalNodes !== 1 ? "s" : ""} unhealthy`
            : `${totalNodes} node${totalNodes !== 1 ? "s" : ""} healthy`,
          href: "/settings/fleet",
        },
        // Audit log shipping
        {
          id: "audit-shipping",
          label: "Audit log shipping",
          status: !configAvailable ? "unknown" : auditShippingActive ? "ok" : "warn",
          detail: !configAvailable
            ? "Could not read audit pipeline status"
            : auditShippingActive
            ? "Active — audit logs shipping to configured destination"
            : "Not deployed — audit events stay local only",
          href: "/settings/audit-shipping",
        },
        // Outbound webhooks
        {
          id: "webhooks",
          label: "Outbound webhooks",
          status: !configAvailable ? "unknown" : webhookCount > 0 ? "ok" : "warn",
          detail: !configAvailable
            ? "Could not read webhook configuration"
            : webhookCount > 0
            ? `${webhookCount} active webhook${webhookCount !== 1 ? "s" : ""}`
            : "No outbound webhooks configured",
          href: "/settings/webhooks",
        },
        // Sentry
        {
          id: "sentry",
          label: "Error tracking (Sentry)",
          status: process.env.SENTRY_DSN ? "ok" : "warn",
          detail: process.env.SENTRY_DSN
            ? "DSN configured"
            : "SENTRY_DSN not set — frontend errors not tracked",
        },
      ];

      const errorCount = signals.filter((s) => s.status === "error").length;
      const warnCount = signals.filter((s) => s.status === "warn").length;
      const unknownCount = signals.filter((s) => s.status === "unknown").length;
      const overallStatus: SignalStatus =
        errorCount > 0 ? "error" : warnCount > 0 || unknownCount > 0 ? "warn" : "ok";

      return { checkedAt, overallStatus, signals };
    }),
});
