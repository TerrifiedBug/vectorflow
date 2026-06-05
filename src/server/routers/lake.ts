import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { withAudit } from "@/server/middleware/audit";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { isLakeEnabled } from "@/server/services/lake/clickhouse";
import {
  LAKE_ALERT_COMPARATORS,
  testFireLakeAlertRule,
} from "@/server/services/lake/lake-alerts";
import {
  searchEvents,
  rawSearchEvents,
  summarizeEvents,
  listTraces,
  getTrace,
  getSchema,
  fieldStats,
  listDatasets,
  LakeRawWhereError,
  LakeSummarizeError,
  LAKE_EVENT_TYPES,
  LAKE_AGG_FUNCTIONS,
  LAKE_MAX_RANGE_MS,
  LAKE_SUMMARIZE_MAX_SERIES,
} from "@/server/services/lake/lake-query";

/**
 * VectorFlow Lake — search-in-place router (A3).
 *
 * Every procedure is tenant-gated via `withTeamAccess` and every handler sources
 * the org scope from `ctx.organizationId` — never from caller input — so the
 * org predicate the query engine binds can never be spoofed across tenants.
 * Guided search/schema/stats are VIEWER; the raw-SQL escape hatch is ADMIN-only.
 *
 * `search`/`rawSearch`/`getSchema`/`fieldStats` carry `pipelineId`, which
 * `withTeamAccess` resolves to the owning team (membership enforced).
 * `listDatasets` carries `teamId` purely so the same gate can verify org
 * membership; the listing itself is org-wide (the lake is an org-scoped store).
 */

const eventTypeSchema = z.enum(LAKE_EVENT_TYPES as unknown as [string, ...string[]]);
const limitSchema = z.number().int().positive().optional();
const aggFnSchema = z.enum(LAKE_AGG_FUNCTIONS as unknown as [string, ...string[]]);

/** to must be on/after from, and the window must not exceed LAKE_MAX_RANGE_MS. */
const withinMaxRange = (data: { from: Date; to: Date }): boolean => {
  const span = data.to.getTime() - data.from.getTime();
  return span >= 0 && span <= LAKE_MAX_RANGE_MS;
};
const rangeMessage = `Invalid time range: 'to' must be on/after 'from' and span at most ${
  LAKE_MAX_RANGE_MS / (24 * 60 * 60 * 1000)
} days`;

const comparatorSchema = z.enum(LAKE_ALERT_COMPARATORS as unknown as [string, ...string[]]);

/** Saved query a lake alert rule evaluates (persisted as LakeAlertRule.spec). */
const alertSpecSchema = z
  .object({
    eventType: eventTypeSchema.optional(),
    query: z.string().max(1000).optional(),
    groupBy: z.string().min(1).max(256).optional(),
    metric: aggFnSchema,
    metricField: z.string().min(1).max(256).optional(),
    windowSeconds: z
      .number()
      .int()
      .positive()
      .max(LAKE_MAX_RANGE_MS / 1000),
  })
  .refine((s) => s.metric === "count" || !!s.metricField?.trim(), {
    message: "A metric field is required for every metric except 'count'",
    path: ["metricField"],
  });

/**
 * Lake alert rules sub-router (`lake.alert.*`). Every mutation carries the
 * owning `pipelineId` (gated by `withTeamAccess`) plus, for the by-id ops, the
 * rule `id` — the handler asserts the rule references the gated pipeline+org
 * before touching it (mirrors the replay router). Cross-org-access compliant.
 */
const lakeAlertRouter = router({
  /** List the org's lake alert rules (org-scoped store; VIEWER). */
  list: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ ctx }) => {
      return prisma.lakeAlertRule.findMany({
        where: { organizationId: ctx.organizationId },
        orderBy: [{ createdAt: "desc" }],
      });
    }),

  /** Create a scheduled threshold alert for a pipeline's lake dataset (EDITOR). */
  create: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        name: z.string().min(1).max(200),
        spec: alertSpecSchema,
        comparator: comparatorSchema,
        threshold: z.number(),
        intervalSeconds: z.number().int().min(60).max(86400).default(300),
        channelId: z.string().optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("lake.alert.created", "LakeAlertRule"))
    .mutation(async ({ input, ctx }) => {
      const pipeline = await prisma.pipeline.findFirst({
        where: { id: input.pipelineId, organizationId: ctx.organizationId },
        select: { environmentId: true },
      });
      if (!pipeline) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
      }
      return prisma.lakeAlertRule.create({
        data: {
          organizationId: ctx.organizationId,
          pipelineId: input.pipelineId,
          environmentId: pipeline.environmentId,
          name: input.name,
          spec: input.spec as Prisma.InputJsonValue,
          comparator: input.comparator,
          threshold: input.threshold,
          intervalSeconds: input.intervalSeconds,
          channelId: input.channelId ?? null,
          enabled: input.enabled ?? true,
        },
      });
    }),

  /** Update a rule (EDITOR). The rule must reference `pipelineId`. */
  update: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        id: z.string(),
        name: z.string().min(1).max(200).optional(),
        spec: alertSpecSchema.optional(),
        comparator: comparatorSchema.optional(),
        threshold: z.number().optional(),
        intervalSeconds: z.number().int().min(60).max(86400).optional(),
        channelId: z.string().nullable().optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("lake.alert.updated", "LakeAlertRule"))
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.lakeAlertRule.findFirst({
        where: { id: input.id, pipelineId: input.pipelineId, organizationId: ctx.organizationId },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Lake alert rule not found" });
      }
      return prisma.lakeAlertRule.update({
        where: { id: input.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.spec !== undefined ? { spec: input.spec as Prisma.InputJsonValue } : {}),
          ...(input.comparator !== undefined ? { comparator: input.comparator } : {}),
          ...(input.threshold !== undefined ? { threshold: input.threshold } : {}),
          ...(input.intervalSeconds !== undefined
            ? { intervalSeconds: input.intervalSeconds }
            : {}),
          ...(input.channelId !== undefined ? { channelId: input.channelId } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        },
      });
    }),

  /** Delete a rule (ADMIN). The rule must reference `pipelineId`. */
  delete: protectedProcedure
    .input(z.object({ pipelineId: z.string(), id: z.string() }))
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("lake.alert.deleted", "LakeAlertRule"))
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.lakeAlertRule.findFirst({
        where: { id: input.id, pipelineId: input.pipelineId, organizationId: ctx.organizationId },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Lake alert rule not found" });
      }
      await prisma.lakeAlertRule.delete({ where: { id: input.id } });
      return { id: input.id };
    }),

  /** Fire a one-off test notification to a rule's channel (EDITOR). */
  testFire: protectedProcedure
    .input(z.object({ pipelineId: z.string(), id: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("lake.alert.tested", "LakeAlertRule"))
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.lakeAlertRule.findFirst({
        where: { id: input.id, pipelineId: input.pipelineId, organizationId: ctx.organizationId },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Lake alert rule not found" });
      }
      return testFireLakeAlertRule({ ruleId: input.id, orgId: ctx.organizationId });
    }),
});

export const lakeRouter = router({
  /** Whether the lake is configured server-side — lets the UI render a clear
   *  'lake not configured' state. Env-level only (no tenant data), so it needs
   *  no team gate. */
  status: protectedProcedure.query(() => ({ enabled: isLakeEnabled() })),

  /** Scheduled threshold alerts over lake datasets. */
  alert: lakeAlertRouter,

  /** Guided/structured search over an org+pipeline time window (VIEWER). */
  search: protectedProcedure
    .input(
      z
        .object({
          pipelineId: z.string(),
          from: z.coerce.date(),
          to: z.coerce.date(),
          eventType: eventTypeSchema.optional(),
          query: z.string().max(1000).optional(),
          limit: limitSchema,
        })
        .refine(withinMaxRange, { message: rangeMessage, path: ["to"] }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input, ctx }) => {
      return searchEvents({
        orgId: ctx.organizationId,
        pipelineId: input.pipelineId,
        from: input.from,
        to: input.to,
        eventType: input.eventType as (typeof LAKE_EVENT_TYPES)[number] | undefined,
        query: input.query,
        limit: input.limit,
      });
    }),

  /** Time-bucketed aggregation: count-over-time, group-by + top-N, and numeric
   *  aggregates (sum/avg/min/max/percentiles) over an org+pipeline window
   *  (VIEWER). Same tenant shape as `search` (carries `pipelineId`), so it stays
   *  cross-org-access compliant without an allowlist change. */
  summarize: protectedProcedure
    .input(
      z
        .object({
          pipelineId: z.string(),
          from: z.coerce.date(),
          to: z.coerce.date(),
          eventType: eventTypeSchema.optional(),
          query: z.string().max(1000).optional(),
          groupBy: z.string().min(1).max(256).optional(),
          metric: aggFnSchema,
          metricField: z.string().min(1).max(256).optional(),
          bucketSeconds: z.number().int().positive().optional(),
          seriesLimit: z.number().int().positive().max(LAKE_SUMMARIZE_MAX_SERIES).optional(),
        })
        .refine(withinMaxRange, { message: rangeMessage, path: ["to"] })
        .refine((d) => d.metric === "count" || !!d.metricField?.trim(), {
          message: "A metric field is required for every metric except 'count'",
          path: ["metricField"],
        }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input, ctx }) => {
      try {
        return await summarizeEvents({
          orgId: ctx.organizationId,
          pipelineId: input.pipelineId,
          from: input.from,
          to: input.to,
          eventType: input.eventType as (typeof LAKE_EVENT_TYPES)[number] | undefined,
          query: input.query,
          groupBy: input.groupBy,
          metric: input.metric as (typeof LAKE_AGG_FUNCTIONS)[number],
          metricField: input.metricField,
          bucketSeconds: input.bucketSeconds,
          seriesLimit: input.seriesLimit,
        });
      } catch (err) {
        if (err instanceof LakeSummarizeError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  /** Raw ClickHouse WHERE-expression search — ADMIN only. The org/pipeline/time
   *  scope and row caps are always enforced server-side as bound predicates. */
  rawSearch: protectedProcedure
    .input(
      z
        .object({
          pipelineId: z.string(),
          from: z.coerce.date(),
          to: z.coerce.date(),
          where: z.string().min(1).max(2000),
          limit: limitSchema,
        })
        .refine(withinMaxRange, { message: rangeMessage, path: ["to"] }),
    )
    .use(withTeamAccess("ADMIN"))
    .query(async ({ input, ctx }) => {
      try {
        return await rawSearchEvents({
          orgId: ctx.organizationId,
          pipelineId: input.pipelineId,
          from: input.from,
          to: input.to,
          where: input.where,
          limit: input.limit,
        });
      } catch (err) {
        if (err instanceof LakeRawWhereError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  /** List the org's lake datasets (catalog metadata). Org-scoped (VIEWER). */
  listDatasets: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ ctx }) => {
      return listDatasets({ orgId: ctx.organizationId });
    }),

  /** Discover a dataset's schema (fixed columns + dynamic attr keys) (VIEWER). */
  getSchema: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input, ctx }) => {
      return getSchema({ orgId: ctx.organizationId, pipelineId: input.pipelineId });
    }),

  /** Top values + counts for a single field over a time window (VIEWER). */
  fieldStats: protectedProcedure
    .input(
      z
        .object({
          pipelineId: z.string(),
          field: z.string().min(1).max(256),
          from: z.coerce.date(),
          to: z.coerce.date(),
          limit: z.number().int().positive().max(1000).optional(),
        })
        .refine(withinMaxRange, { message: rangeMessage, path: ["to"] }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input, ctx }) => {
      return fieldStats({
        orgId: ctx.organizationId,
        pipelineId: input.pipelineId,
        field: input.field,
        from: input.from,
        to: input.to,
        limit: input.limit,
      });
    }),

  /** Recent traces (grouped by traceId) over an org+pipeline window (VIEWER). */
  listTraces: protectedProcedure
    .input(
      z
        .object({
          pipelineId: z.string(),
          from: z.coerce.date(),
          to: z.coerce.date(),
          limit: limitSchema,
        })
        .refine(withinMaxRange, { message: rangeMessage, path: ["to"] }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input, ctx }) => {
      return listTraces({
        orgId: ctx.organizationId,
        pipelineId: input.pipelineId,
        from: input.from,
        to: input.to,
        limit: input.limit,
      });
    }),

  /** All spans of a single trace, ordered by start time (VIEWER). */
  getTrace: protectedProcedure
    .input(z.object({ pipelineId: z.string(), traceId: z.string().min(1).max(256) }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input, ctx }) => {
      return getTrace({
        orgId: ctx.organizationId,
        pipelineId: input.pipelineId,
        traceId: input.traceId,
      });
    }),
});
