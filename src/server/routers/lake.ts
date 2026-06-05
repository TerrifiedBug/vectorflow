import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { isLakeEnabled } from "@/server/services/lake/clickhouse";
import {
  searchEvents,
  rawSearchEvents,
  getSchema,
  fieldStats,
  listDatasets,
  LakeRawWhereError,
  LAKE_EVENT_TYPES,
  LAKE_MAX_RANGE_MS,
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

/** to must be on/after from, and the window must not exceed LAKE_MAX_RANGE_MS. */
const withinMaxRange = (data: { from: Date; to: Date }): boolean => {
  const span = data.to.getTime() - data.from.getTime();
  return span >= 0 && span <= LAKE_MAX_RANGE_MS;
};
const rangeMessage = `Invalid time range: 'to' must be on/after 'from' and span at most ${
  LAKE_MAX_RANGE_MS / (24 * 60 * 60 * 1000)
} days`;

export const lakeRouter = router({
  /** Whether the lake is configured server-side — lets the UI render a clear
   *  'lake not configured' state. Env-level only (no tenant data), so it needs
   *  no team gate. */
  status: protectedProcedure.query(() => ({ enabled: isLakeEnabled() })),

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
});
