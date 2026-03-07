import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireSuperAdmin } from "@/trpc/init";
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
        updatedAt: settings.updatedAt,
      };
    }),

  updateOidc: protectedProcedure
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

      return prisma.systemSettings.update({
        where: { id: SETTINGS_ID },
        data: {
          oidcGroupSyncEnabled: input.groupSyncEnabled,
          oidcTeamMappings: JSON.stringify(input.mappings),
          oidcDefaultTeamId: input.defaultTeamId || null,
          oidcDefaultRole: input.defaultRole,
          oidcGroupsClaim: input.groupsClaim,
          // Clear legacy fields when saving new team mappings
          oidcAdminGroups: null,
          oidcEditorGroups: null,
        },
      });
    }),

  updateFleet: protectedProcedure
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

  testOidc: protectedProcedure
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

  deleteBackup: protectedProcedure
    .use(requireSuperAdmin())
    .input(z.object({ filename: z.string().min(1) }))
    .use(withAudit("settings.backup_deleted", "SystemSettings"))
    .mutation(async ({ input }) => {
      await deleteBackup(input.filename);
      return { success: true };
    }),

  restoreBackup: protectedProcedure
    .use(requireSuperAdmin())
    .input(z.object({ filename: z.string().min(1) }))
    .use(withAudit("settings.backup_restored", "SystemSettings"))
    .mutation(async ({ input }) => {
      await restoreFromBackup(input.filename);
      return { success: true };
    }),

  updateBackupSchedule: protectedProcedure
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
});
