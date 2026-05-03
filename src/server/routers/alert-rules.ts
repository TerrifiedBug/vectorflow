import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AlertMetric, AlertCondition } from "@/generated/prisma";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import { isEventMetric } from "@/server/services/event-alerts";
import { FLEET_METRICS, PIPELINE_FLEET_METRICS } from "@/server/services/alert-evaluator";

export const alertRulesRouter = router({
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
        severity: z.enum(["info", "warning", "critical"]).default("warning"),
        ownerHint: z.string().min(1).max(120).default("platform-ops"),
        suggestedAction: z.string().min(1).max(1000).default(
          "Review the alert context, then inspect the affected pipeline, node, and recent deployment changes.",
        ),
        cooldownMinutes: z.number().int().min(0).max(1440).nullable().optional(),
        teamId: z.string(),
        channelIds: z.array(z.string()).optional(),
        keyword: z.string().min(1).max(500).optional(),
        keywordSeverityFilter: z.enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR"]).nullable().optional(),
        keywordWindowMinutes: z.number().int().min(1).max(60).nullable().optional(),
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

      // Environment-scoped fleet metrics: reject pipelineId.
      if (
        FLEET_METRICS.has(input.metric) &&
        !PIPELINE_FLEET_METRICS.has(input.metric) &&
        input.pipelineId
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Fleet metrics apply to the entire environment and cannot be scoped to a specific pipeline",
        });
      }

      // Pipeline-scoped fleet metrics (latency_mean, throughput_floor): require pipelineId.
      if (PIPELINE_FLEET_METRICS.has(input.metric) && !input.pipelineId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This metric requires selecting a specific pipeline",
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

      // Keyword alerts require keyword field and use threshold for match count
      if (input.metric === "log_keyword") {
        if (!input.keyword) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Keyword is required for log keyword alerts",
          });
        }
        input.durationSeconds = null;
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
          severity: input.severity,
          ownerHint: input.ownerHint,
          suggestedAction: input.suggestedAction,
          cooldownMinutes: input.cooldownMinutes,
          keyword: input.keyword,
          keywordSeverityFilter: input.keywordSeverityFilter,
          keywordWindowMinutes: input.keywordWindowMinutes,
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
        severity: z.enum(["info", "warning", "critical"]).optional(),
        ownerHint: z.string().min(1).max(120).optional(),
        suggestedAction: z.string().min(1).max(1000).optional(),
        cooldownMinutes: z.number().int().min(0).max(1440).nullable().optional(),
        channelIds: z.array(z.string()).optional(),
        keyword: z.string().min(1).max(500).optional(),
        keywordSeverityFilter: z.enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR"]).nullable().optional(),
        keywordWindowMinutes: z.number().int().min(1).max(60).nullable().optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alertRule.updated", "AlertRule"))
    .mutation(async ({ input }) => {
      const { id, channelIds, keyword, keywordSeverityFilter, keywordWindowMinutes, ...data } = input;
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
        data: {
          ...data,
          ...(keyword !== undefined ? { keyword } : {}),
          ...(keywordSeverityFilter !== undefined ? { keywordSeverityFilter } : {}),
          ...(keywordWindowMinutes !== undefined ? { keywordWindowMinutes } : {}),
        },
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
});
