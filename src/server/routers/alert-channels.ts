import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@/generated/prisma";
import { router, protectedProcedure, withTeamAccess, denyInDemo } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import { validatePublicUrl, validateSmtpHost } from "@/server/services/url-validation";
import { getDriver } from "@/server/services/channels";
import { encryptChannelConfig } from "@/server/services/channel-secrets";

export const alertChannelsRouter = router({
  listChannels: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const channels = await prisma.notificationChannel.findMany({
        where: { environmentId: input.environmentId },
        select: {
          id: true,
          environmentId: true,
          name: true,
          type: true,
          config: true,
          enabled: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "desc" },
      });

      // Redact sensitive config fields before sending to the client
      return channels.map((ch) => {
        const config = ch.config as Record<string, unknown>;
        const safeConfig = { ...config };

        // Redact passwords and secrets
        if ("smtpPass" in safeConfig) safeConfig.smtpPass = "••••••••";
        if ("hmacSecret" in safeConfig && safeConfig.hmacSecret)
          safeConfig.hmacSecret = "••••••••";
        if ("integrationKey" in safeConfig)
          safeConfig.integrationKey = "••••••••";

        return { ...ch, config: safeConfig };
      });
    }),

  createChannel: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        name: z.string().min(1).max(200),
        type: z.enum(["slack", "email", "pagerduty", "webhook"]),
        config: z.record(z.string(), z.unknown()),
      }),
    )
    .use(denyInDemo())
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("notificationChannel.created", "NotificationChannel"))
    .mutation(async ({ input }) => {
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
      });
      if (!env) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }

      // Validate URLs for Slack and Webhook types (SSRF protection)
      if (input.type === "slack") {
        const webhookUrl = input.config.webhookUrl as string | undefined;
        if (!webhookUrl) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Slack channels require a webhookUrl",
          });
        }
        await validatePublicUrl(webhookUrl);
      }

      if (input.type === "webhook") {
        const url = input.config.url as string | undefined;
        if (!url) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Webhook channels require a url",
          });
        }
        await validatePublicUrl(url);
      }

      if (input.type === "email") {
        const { smtpHost, from, recipients } = input.config as Record<string, unknown>;
        if (!smtpHost || typeof smtpHost !== "string")
          throw new TRPCError({ code: "BAD_REQUEST", message: "Email channels require smtpHost" });
        if (!from || typeof from !== "string")
          throw new TRPCError({ code: "BAD_REQUEST", message: "Email channels require a from address" });
        if (!Array.isArray(recipients) || recipients.length === 0)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Email channels require at least one recipient" });
        await validateSmtpHost(smtpHost);
      }

      if (input.type === "pagerduty") {
        const { integrationKey } = input.config as Record<string, unknown>;
        if (!integrationKey || typeof integrationKey !== "string")
          throw new TRPCError({ code: "BAD_REQUEST", message: "PagerDuty channels require an integrationKey" });
      }

      return prisma.notificationChannel.create({
        data: {
          environmentId: input.environmentId,
          name: input.name,
          type: input.type,
          config: encryptChannelConfig(input.type, input.config) as Prisma.InputJsonValue,
        },
      });
    }),

  updateChannel: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200).optional(),
        config: z.record(z.string(), z.unknown()).optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .use(denyInDemo())
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("notificationChannel.updated", "NotificationChannel"))
    .mutation(async ({ input }) => {
      const { id, config, ...rest } = input;
      const existing = await prisma.notificationChannel.findUnique({
        where: { id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Notification channel not found",
        });
      }

      if (config) {
        // 1. SSRF-validate any new URLs supplied by the caller
        if (existing.type === "slack") {
          const webhookUrl = config.webhookUrl as string | undefined;
          if (webhookUrl) await validatePublicUrl(webhookUrl);
        }
        if (existing.type === "webhook") {
          const url = config.url as string | undefined;
          if (url) await validatePublicUrl(url);
        }
        if (existing.type === "email") {
          const smtpHost = config.smtpHost as string | undefined;
          if (smtpHost) await validateSmtpHost(smtpHost);
        }

        // 2. Preserve sensitive fields that the client cannot see (redacted in listChannels).
        //    When editing, the form sends empty strings for secrets it didn't change.
        const existingCfg = (existing.config ?? {}) as Record<string, unknown>;
        const PRESERVE_IF_ABSENT = ["smtpPass", "integrationKey", "hmacSecret"] as const;
        for (const field of PRESERVE_IF_ABSENT) {
          if (!(field in config) || config[field] === "" || config[field] === undefined) {
            if (field in existingCfg) {
              (config as Record<string, unknown>)[field] = existingCfg[field];
            }
          }
        }

        // 3. Validate the MERGED config still has all required fields.
        if (existing.type === "slack") {
          const webhookUrl = config.webhookUrl as string | undefined;
          if (!webhookUrl)
            throw new TRPCError({ code: "BAD_REQUEST", message: "Slack channels require a webhookUrl" });
        }
        if (existing.type === "webhook") {
          const url = config.url as string | undefined;
          if (!url)
            throw new TRPCError({ code: "BAD_REQUEST", message: "Webhook channels require a url" });
        }
        if (existing.type === "email") {
          const { smtpHost, from, recipients } = config as Record<string, unknown>;
          if (!smtpHost || typeof smtpHost !== "string")
            throw new TRPCError({ code: "BAD_REQUEST", message: "Email channels require smtpHost" });
          if (!from || typeof from !== "string")
            throw new TRPCError({ code: "BAD_REQUEST", message: "Email channels require a from address" });
          if (!Array.isArray(recipients) || recipients.length === 0)
            throw new TRPCError({ code: "BAD_REQUEST", message: "Email channels require at least one recipient" });
        }
        if (existing.type === "pagerduty") {
          const { integrationKey } = config as Record<string, unknown>;
          if (!integrationKey || typeof integrationKey !== "string")
            throw new TRPCError({ code: "BAD_REQUEST", message: "PagerDuty channels require an integrationKey" });
        }
      }

      return prisma.notificationChannel.update({
        where: { id },
        data: {
          ...rest,
          ...(config !== undefined
            ? { config: config as Prisma.InputJsonValue }
            : {}),
        },
      });
    }),

  deleteChannel: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(denyInDemo())
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("notificationChannel.deleted", "NotificationChannel"))
    .mutation(async ({ input }) => {
      const existing = await prisma.notificationChannel.findUnique({
        where: { id: input.id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Notification channel not found",
        });
      }

      await prisma.notificationChannel.delete({ where: { id: input.id } });
      return { deleted: true };
    }),

  testChannel: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(denyInDemo())
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("notificationChannel.tested", "NotificationChannel"))
    .mutation(async ({ input }) => {
      const channel = await prisma.notificationChannel.findUnique({
        where: { id: input.id },
      });
      if (!channel) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Notification channel not found",
        });
      }

      try {
        const driver = getDriver(channel.type);
        const result = await driver.test(
          channel.config as Record<string, unknown>,
        );
        return {
          success: result.success,
          error: result.error,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    }),
});
