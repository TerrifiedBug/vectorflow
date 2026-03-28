import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { Prisma, AlertMetric, AlertCondition } from "@/generated/prisma";
import { withAudit } from "@/server/middleware/audit";
import crypto from "crypto";
import {
  type WebhookPayload,
  formatWebhookMessage,
} from "@/server/services/webhook-delivery";
import { validatePublicUrl, validateSmtpHost } from "@/server/services/url-validation";
import { getDriver } from "@/server/services/channels";
import { isEventMetric } from "@/server/services/event-alerts";
import { FLEET_METRICS } from "@/server/services/alert-evaluator";

export const alertRouter = router({
  // ─── Alert Rules ───────────────────────────────────────────────────

  listRules: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.alertRule.findMany({
        where: { environmentId: input.environmentId },
        include: {
          pipeline: { select: { id: true, name: true } },
          channels: {
            select: { channelId: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  createRule: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        environmentId: z.string(),
        pipelineId: z.string().optional(),
        metric: z.nativeEnum(AlertMetric),
        condition: z.nativeEnum(AlertCondition).nullable().optional(),
        threshold: z.number().nullable().optional(),
        durationSeconds: z.number().int().min(1).nullable().optional(),
        teamId: z.string(),
        channelIds: z.array(z.string()).optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alertRule.created", "AlertRule"))
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

      if (input.pipelineId) {
        const pipeline = await prisma.pipeline.findUnique({
          where: { id: input.pipelineId },
        });
        if (!pipeline || pipeline.environmentId !== input.environmentId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Pipeline not found in this environment",
          });
        }
      }

      // Validate channels BEFORE creating the rule to avoid orphans on failure
      if (input.channelIds?.length) {
        const channelCount = await prisma.notificationChannel.count({
          where: {
            id: { in: input.channelIds },
            environmentId: input.environmentId,
          },
        });
        if (channelCount !== input.channelIds.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "One or more channel IDs are invalid or belong to a different environment",
          });
        }
      }

      // Fleet metrics apply to the entire environment — reject if pipelineId is set
      if (FLEET_METRICS.has(input.metric) && input.pipelineId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Fleet metrics apply to the entire environment and cannot be scoped to a specific pipeline",
        });
      }

      // Event-based metrics fire on occurrence — they don't use thresholds
      if (isEventMetric(input.metric)) {
        input.condition = null;
        input.threshold = null;
        input.durationSeconds = null;
      } else {
        if (!input.condition || input.threshold == null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Infrastructure metrics require condition and threshold",
          });
        }
      }

      const rule = await prisma.alertRule.create({
        data: {
          name: input.name,
          environmentId: input.environmentId,
          pipelineId: input.pipelineId,
          teamId: input.teamId,
          metric: input.metric,
          condition: input.condition,
          threshold: input.threshold,
          durationSeconds: input.durationSeconds,
        },
      });

      if (input.channelIds?.length) {
        await prisma.alertRuleChannel.createMany({
          data: input.channelIds.map((channelId) => ({
            alertRuleId: rule.id,
            channelId,
          })),
          skipDuplicates: true,
        });
      }

      return rule;
    }),

  updateRule: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200).optional(),
        enabled: z.boolean().optional(),
        threshold: z.number().optional(),
        durationSeconds: z.number().int().min(1).optional(),
        channelIds: z.array(z.string()).optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alertRule.updated", "AlertRule"))
    .mutation(async ({ input }) => {
      const { id, channelIds, ...data } = input;
      const existing = await prisma.alertRule.findUnique({
        where: { id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert rule not found",
        });
      }

      if (channelIds !== undefined && channelIds.length > 0) {
        // Validate all channels belong to the same environment as the rule
        const channelCount = await prisma.notificationChannel.count({
          where: {
            id: { in: channelIds },
            environmentId: existing.environmentId,
          },
        });
        if (channelCount !== channelIds.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "One or more channel IDs are invalid or belong to a different environment",
          });
        }
      }

      const rule = await prisma.alertRule.update({
        where: { id },
        data,
      });

      if (channelIds !== undefined) {
        // Replace all channel links atomically
        await prisma.$transaction(async (tx) => {
          await tx.alertRuleChannel.deleteMany({
            where: { alertRuleId: id },
          });
          if (channelIds.length > 0) {
            await tx.alertRuleChannel.createMany({
              data: channelIds.map((channelId) => ({
                alertRuleId: id,
                channelId,
              })),
              skipDuplicates: true,
            });
          }
        });
      }

      return rule;
    }),

  deleteRule: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alertRule.deleted", "AlertRule"))
    .mutation(async ({ input }) => {
      const existing = await prisma.alertRule.findUnique({
        where: { id: input.id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert rule not found",
        });
      }

      await prisma.alertRule.delete({ where: { id: input.id } });
      return { deleted: true };
    }),

  // ─── Alert Webhooks ────────────────────────────────────────────────

  listWebhooks: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.alertWebhook.findMany({
        where: { environmentId: input.environmentId },
        select: {
          id: true,
          environmentId: true,
          url: true,
          headers: true,
          enabled: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  createWebhook: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        url: z.string().url(),
        headers: z.record(z.string(), z.string()).optional(),
        hmacSecret: z.string().optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alertWebhook.created", "AlertWebhook"))
    .mutation(async ({ input }) => {
      await validatePublicUrl(input.url);
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
      });
      if (!env) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }

      return prisma.alertWebhook.create({
        data: {
          environmentId: input.environmentId,
          url: input.url,
          headers: input.headers ?? undefined,
          hmacSecret: input.hmacSecret,
        },
      });
    }),

  updateWebhook: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        url: z.string().url().optional(),
        headers: z.record(z.string(), z.string()).nullable().optional(),
        hmacSecret: z.string().nullable().optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alertWebhook.updated", "AlertWebhook"))
    .mutation(async ({ input }) => {
      if (input.url) {
        await validatePublicUrl(input.url);
      }
      const { id, headers, ...rest } = input;
      const existing = await prisma.alertWebhook.findUnique({
        where: { id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert webhook not found",
        });
      }

      return prisma.alertWebhook.update({
        where: { id },
        data: {
          ...rest,
          ...(headers !== undefined
            ? { headers: headers === null ? Prisma.DbNull : headers }
            : {}),
        },
      });
    }),

  deleteWebhook: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alertWebhook.deleted", "AlertWebhook"))
    .mutation(async ({ input }) => {
      const existing = await prisma.alertWebhook.findUnique({
        where: { id: input.id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert webhook not found",
        });
      }

      await prisma.alertWebhook.delete({ where: { id: input.id } });
      return { deleted: true };
    }),

  testWebhook: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input }) => {
      const webhook = await prisma.alertWebhook.findUnique({
        where: { id: input.id },
        include: {
          environment: {
            select: { name: true, team: { select: { name: true } } },
          },
        },
      });
      if (!webhook) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert webhook not found",
        });
      }

      await validatePublicUrl(webhook.url);

      const payload: WebhookPayload = {
        alertId: "test-alert-id",
        status: "firing",
        ruleName: "Test Alert Rule",
        severity: "warning",
        environment: webhook.environment.name,
        team: webhook.environment.team?.name,
        node: "test-node.example.com",
        metric: "cpu_usage",
        value: 85.5,
        threshold: 80,
        message: "CPU usage is 85.50 (threshold: > 80)",
        timestamp: new Date().toISOString(),
        dashboardUrl: `${process.env.NEXTAUTH_URL ?? ""}/alerts`,
      };

      const outgoing = {
        ...payload,
        content: formatWebhookMessage(payload),
      };

      const body = JSON.stringify(outgoing);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...((webhook.headers as Record<string, string>) ?? {}),
      };

      if (webhook.hmacSecret) {
        const signature = crypto
          .createHmac("sha256", webhook.hmacSecret)
          .update(body)
          .digest("hex");
        headers["X-VectorFlow-Signature"] = `sha256=${signature}`;
      }

      try {
        const res = await fetch(webhook.url, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(10000),
        });

        return {
          success: res.ok,
          statusCode: res.status,
          statusText: res.statusText,
        };
      } catch (err) {
        return {
          success: false,
          statusCode: 0,
          statusText: err instanceof Error ? err.message : "Unknown error",
        };
      }
    }),

  // ─── Notification Channels ─────────────────────────────────────────

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
          config: input.config as Prisma.InputJsonValue,
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
        //    This prevents saving a broken channel via `config: {}`.
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

  // ─── Acknowledge & Snooze ────────────────────────────────────────

  acknowledgeEvent: protectedProcedure
    .input(z.object({ alertEventId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alertEvent.acknowledged", "AlertEvent"))
    .mutation(async ({ input, ctx }) => {
      const event = await prisma.alertEvent.findUnique({
        where: { id: input.alertEventId },
      });
      if (!event) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert event not found",
        });
      }
      if (event.status !== "firing") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only firing alerts can be acknowledged",
        });
      }

      const user = ctx.session.user;
      const acknowledgedBy =
        user?.email || user?.name || user?.id || "unknown";

      return prisma.alertEvent.update({
        where: { id: input.alertEventId },
        data: {
          status: "acknowledged",
          acknowledgedAt: new Date(),
          acknowledgedBy,
        },
      });
    }),

  snoozeRule: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        duration: z.number().int().min(1).max(43200),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alertRule.snoozed", "AlertRule"))
    .mutation(async ({ input }) => {
      const existing = await prisma.alertRule.findUnique({
        where: { id: input.id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert rule not found",
        });
      }

      const snoozedUntil = new Date(
        Date.now() + input.duration * 60 * 1000,
      );

      return prisma.alertRule.update({
        where: { id: input.id },
        data: { snoozedUntil },
      });
    }),

  unsnoozeRule: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alertRule.unsnoozed", "AlertRule"))
    .mutation(async ({ input }) => {
      const existing = await prisma.alertRule.findUnique({
        where: { id: input.id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert rule not found",
        });
      }

      return prisma.alertRule.update({
        where: { id: input.id },
        data: { snoozedUntil: null },
      });
    }),

  listDeliveries: protectedProcedure
    .input(z.object({ alertEventId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.deliveryAttempt.findMany({
        where: { alertEventId: input.alertEventId },
        select: {
          id: true,
          channelType: true,
          channelName: true,
          status: true,
          statusCode: true,
          errorMessage: true,
          requestedAt: true,
          completedAt: true,
          attemptNumber: true,
        },
        orderBy: { requestedAt: "desc" },
      });
    }),

  listChannelDeliveries: protectedProcedure
    .input(
      z.object({
        channelName: z.string(),
        channelType: z.string(),
        limit: z.number().min(1).max(50).default(10),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.deliveryAttempt.findMany({
        where: {
          channelName: input.channelName,
          channelType: input.channelType,
        },
        select: {
          id: true,
          channelType: true,
          channelName: true,
          status: true,
          statusCode: true,
          errorMessage: true,
          requestedAt: true,
          completedAt: true,
          attemptNumber: true,
        },
        orderBy: { requestedAt: "desc" },
        take: input.limit,
      });
    }),

  retryDelivery: protectedProcedure
    .input(z.object({ deliveryAttemptId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alert.retryDelivery", "DeliveryAttempt"))
    .mutation(async ({ input }) => {
      const attempt = await prisma.deliveryAttempt.findUnique({
        where: { id: input.deliveryAttemptId },
        include: {
          alertEvent: {
            include: {
              alertRule: {
                include: {
                  environment: { select: { name: true, team: { select: { name: true } } } },
                  pipeline: { select: { name: true } },
                },
              },
              node: { select: { host: true } },
            },
          },
        },
      });

      if (!attempt) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Delivery attempt not found" });
      }

      if (attempt.status !== "failed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only failed deliveries can be retried" });
      }

      const event = attempt.alertEvent;
      if (!event?.alertRule) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Associated alert event or rule not found" });
      }

      const rule = event.alertRule;
      const payload: WebhookPayload = {
        alertId: event.id,
        status: event.status === "resolved" ? "resolved" : "firing",
        ruleName: rule.name,
        severity: "warning",
        environment: rule.environment.name,
        team: rule.environment.team?.name,
        node: event.node?.host ?? undefined,
        pipeline: rule.pipeline?.name ?? undefined,
        metric: rule.metric,
        value: event.value,
        threshold: rule.threshold ?? 0,
        message: event.message ?? "",
        timestamp: event.firedAt.toISOString(),
        dashboardUrl: `${process.env.NEXTAUTH_URL ?? ""}/alerts`,
      };

      const nextAttemptNumber = attempt.attemptNumber + 1;

      if (attempt.webhookId) {
        const webhook = await prisma.alertWebhook.findUnique({ where: { id: attempt.webhookId } });
        if (!webhook) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found" });
        }
        const { trackWebhookDelivery } = await import("@/server/services/delivery-tracking");
        const { deliverSingleWebhook } = await import("@/server/services/webhook-delivery");
        await trackWebhookDelivery(
          event.id,
          webhook.id,
          webhook.url,
          () => deliverSingleWebhook(webhook, payload),
          nextAttemptNumber,
        );
      } else if (attempt.channelId) {
        const channel = await prisma.notificationChannel.findUnique({ where: { id: attempt.channelId } });
        if (!channel) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Notification channel not found" });
        }
        const { trackChannelDelivery } = await import("@/server/services/delivery-tracking");
        const channelDriver = getDriver(channel.type);
        await trackChannelDelivery(
          event.id,
          channel.id,
          channel.type,
          channel.name,
          async () => {
            const result = await channelDriver.deliver(channel.config as Record<string, unknown>, payload);
            return { success: result.success, error: result.error };
          },
          nextAttemptNumber,
        );
      } else {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Delivery attempt has no target webhook or channel" });
      }

      return { success: true };
    }),

  // ─── Failed Deliveries ────────────────────────────────────────────

  listFailedDeliveries: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.deliveryAttempt.findMany({
        where: {
          status: "failed",
          alertEvent: {
            alertRule: {
              environmentId: input.environmentId,
            },
          },
        },
        select: {
          id: true,
          channelType: true,
          channelName: true,
          status: true,
          statusCode: true,
          errorMessage: true,
          requestedAt: true,
          completedAt: true,
          attemptNumber: true,
          alertEventId: true,
          alertEvent: {
            select: {
              alertRule: {
                select: { name: true },
              },
            },
          },
        },
        orderBy: { requestedAt: "desc" },
        take: input.limit,
      });
    }),

  retryAllForChannel: protectedProcedure
    .input(
      z.object({
        channelName: z.string(),
        channelType: z.string(),
        environmentId: z.string(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alert.retryAllForChannel", "DeliveryAttempt"))
    .mutation(async ({ input }) => {
      const failedAttempts = await prisma.deliveryAttempt.findMany({
        where: {
          status: "failed",
          channelName: input.channelName,
          channelType: input.channelType,
          alertEvent: {
            alertRule: {
              environmentId: input.environmentId,
            },
          },
        },
        select: { id: true },
        take: 50,
      });

      const ids = failedAttempts.map((a) => a.id);
      if (ids.length > 0) {
        await prisma.deliveryAttempt.updateMany({
          where: { id: { in: ids } },
          data: { nextRetryAt: new Date() },
        });
      }

      return { retriedCount: ids.length, totalFailed: failedAttempts.length };
    }),

  // ─── Alert Events ──────────────────────────────────────────────────

  listEvents: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        limit: z.number().min(1).max(200).default(50),
        cursor: z.string().optional(),
        status: z.enum(["firing", "resolved", "acknowledged"]).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const { environmentId, limit, cursor, status, dateFrom, dateTo } = input;

      // Exclude informational event metrics (deploys, version checks) from history;
      // they still fire notifications but aren't surfaced in the alert table.
      const HIDDEN_METRICS: AlertMetric[] = [
        "deploy_requested",
        "deploy_completed",
        "deploy_rejected",
        "deploy_cancelled",
        "new_version_available",
      ];

      const where: Prisma.AlertEventWhereInput = {
        alertRule: { environmentId, metric: { notIn: HIDDEN_METRICS } },
        ...(status ? { status } : {}),
        ...(dateFrom ?? dateTo
          ? {
              firedAt: {
                ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                ...(dateTo ? { lte: new Date(dateTo + "T23:59:59.999Z") } : {}),
              },
            }
          : {}),
      };

      const items = await prisma.alertEvent.findMany({
        where,
        include: {
          alertRule: {
            select: {
              id: true,
              name: true,
              metric: true,
              condition: true,
              threshold: true,
              pipeline: { select: { id: true, name: true } },
            },
          },
          node: {
            select: { id: true, host: true },
          },
        },
        orderBy: { firedAt: "desc" },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      let nextCursor: string | undefined;
      if (items.length > limit) {
        const nextItem = items.pop();
        nextCursor = nextItem?.id;
      }

      return { items, nextCursor };
    }),
});
