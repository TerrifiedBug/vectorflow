import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AlertMetric, AlertCondition } from "@/generated/prisma";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import { isEventMetric } from "@/server/services/event-alerts";
import { FLEET_METRICS, PIPELINE_FLEET_METRICS } from "@/server/services/alert-evaluator";
import { queryPipelineMetricsAggregated } from "@/server/services/metrics-query";
import {
  evaluateRuleHistory,
  unsupportedPreviewReason,
} from "@/server/services/alert-test";

export const alertRulesRouter = router({
  getRule: protectedProcedure
    .input(z.object({ id: z.string(), teamId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const rule = await prisma.alertRule.findUnique({
        where: { id: input.id },
        include: {
          environment: { select: { id: true, name: true } },
          pipeline: { select: { id: true, name: true } },
          channels: { include: { channel: true } },
        },
      });
      if (!rule || rule.teamId !== input.teamId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Alert rule not found" });
      }
      return rule;
    }),

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
        ownerHint: z.string().trim().min(1).max(120).default("platform-ops"),
        suggestedAction: z.string().trim().min(1).max(1000).default(
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
        ownerHint: z.string().trim().min(1).max(120).optional(),
        suggestedAction: z.string().trim().min(1).max(1000).optional(),
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

  /**
   * Live-preview helper for the alert rule editor.
   *
   * Replays the rule's condition + threshold + duration over the last
   * N hours of pipeline metric history and returns:
   *   - the projected metric series
   *   - the breach windows that would have produced an alert event
   *   - the count of distinct fires
   *
   * For metrics that aren't time-series (event-based, drift, fleet aggregates,
   * node-scoped), returns `{ supported: false, reason: "..." }` with a hint
   * the UI surfaces verbatim.
   */
  /**
   * Surfaces existing alert rules that overlap with the rule the user is
   * currently authoring (same team + same metric + overlapping scope).
   *
   * The editor uses this to render an inline warning so users don't end up
   * with two near-duplicate rules firing on the same pipeline.
   *
   * Scope-overlap rules:
   *   - If a pipeline is selected: any rule on the same pipelineId.
   *   - If only an environment is selected: env-wide rules in that env
   *     (pipelineId=null) — note these would overlap with any future
   *     pipeline-scoped rule in the same env.
   *   - If neither is selected: team-wide rules (both null).
   *
   * `excludeId` lets the edit form omit the rule being edited from results.
   */
  findSimilar: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        pipelineId: z.string().nullish(),
        environmentId: z.string().nullish(),
        metric: z.nativeEnum(AlertMetric),
        excludeId: z.string().nullish(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const orClauses: Array<Record<string, unknown>> = [];

      if (input.pipelineId) {
        orClauses.push({ pipelineId: input.pipelineId });
      } else {
        orClauses.push({
          pipelineId: null,
          environmentId: input.environmentId ?? null,
        });
      }

      if (input.environmentId) {
        orClauses.push({
          environmentId: input.environmentId,
          pipelineId: null,
        });
      }

      const matches = await prisma.alertRule.findMany({
        where: {
          teamId: input.teamId,
          metric: input.metric,
          ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
          OR: orClauses,
        },
        take: 3,
        select: {
          id: true,
          name: true,
          metric: true,
          condition: true,
          threshold: true,
          environment: { select: { id: true, name: true } },
          pipeline: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: "desc" },
      });

      return { matches };
    }),

  testRule: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        pipelineId: z.string().nullish(),
        environmentId: z.string().nullish(),
        metric: z.nativeEnum(AlertMetric),
        condition: z.nativeEnum(AlertCondition),
        threshold: z.number(),
        durationSeconds: z.number().int().min(0),
        lookbackHours: z.number().int().min(1).max(72).default(6),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const reason = unsupportedPreviewReason(input.metric);
      if (reason) {
        return {
          supported: false as const,
          reason,
          lookbackHours: input.lookbackHours,
        };
      }

      if (!input.pipelineId) {
        // Environment-wide preview is not implemented for Phase A — preview
        // requires a specific pipeline because the metric source query is
        // pipeline-scoped.
        return {
          supported: false as const,
          reason: input.environmentId
            ? "Environment-wide preview isn't supported yet — pick a specific pipeline."
            : "Pick a pipeline to preview historical breaches.",
          lookbackHours: input.lookbackHours,
        };
      }

      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        select: { environmentId: true, environment: { select: { teamId: true } } },
      });
      if (
        !pipeline ||
        pipeline.environment.teamId !== input.teamId ||
        (input.environmentId && pipeline.environmentId !== input.environmentId)
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
      }

      const { rows } = await queryPipelineMetricsAggregated({
        pipelineId: input.pipelineId,
        minutes: input.lookbackHours * 60,
      });

      const { series, breaches, wouldHaveFired } = evaluateRuleHistory({
        rows,
        metric: input.metric,
        condition: input.condition,
        threshold: input.threshold,
        durationSeconds: input.durationSeconds,
      });

      return {
        supported: true as const,
        series,
        threshold: input.threshold,
        breaches,
        wouldHaveFired,
        lookbackHours: input.lookbackHours,
      };
    }),
});
