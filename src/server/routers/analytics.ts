// src/server/routers/analytics.ts
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import {
  getCostSummary,
  getCostByPipeline,
  getCostByTeam,
  getCostByEnvironment,
  getCostTimeSeries,
  getPipelineCostSnapshot,
  formatCostCsv,
} from "@/server/services/cost-attribution";

const rangeSchema = z.enum(["1h", "6h", "1d", "7d", "30d"]);

export const analyticsRouter = router({
  /** Aggregated cost summary for KPI cards. */
  costSummary: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        range: rangeSchema,
      })
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
        select: { costPerGbCents: true },
      });
      if (!env) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
      }

      return getCostSummary({
        environmentId: input.environmentId,
        range: input.range,
        costPerGbCents: env.costPerGbCents,
      });
    }),

  /** Per-pipeline cost breakdown table. */
  costByPipeline: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        range: rangeSchema,
      })
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
        select: { costPerGbCents: true },
      });
      if (!env) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
      }

      return getCostByPipeline({
        environmentId: input.environmentId,
        range: input.range,
        costPerGbCents: env.costPerGbCents,
      });
    }),

  /** Top 5 pipelines by bytes processed (for KPI card). */
  topPipelines: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        range: rangeSchema,
      })
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
        select: { costPerGbCents: true },
      });
      if (!env) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
      }

      const rows = await getCostByPipeline({
        environmentId: input.environmentId,
        range: input.range,
        costPerGbCents: env.costPerGbCents,
      });

      return rows
        .sort((a, b) => b.bytesIn - a.bytesIn)
        .slice(0, 5);
    }),

  /** Team rollup for chargeback reports. */
  costByTeam: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        range: rangeSchema,
      })
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ ctx, input }) => {
      // Resolve team IDs the user has access to
      const userId = ctx.session!.user!.id!;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isSuperAdmin: true },
      });

      let teamIds: string[];
      if (user?.isSuperAdmin) {
        const teams = await prisma.team.findMany({ select: { id: true } });
        teamIds = teams.map((t) => t.id);
      } else {
        const memberships = await prisma.teamMember.findMany({
          where: { userId },
          select: { teamId: true },
        });
        teamIds = memberships.map((m) => m.teamId);
      }

      return getCostByTeam({ teamIds, range: input.range });
    }),

  /** Environment comparison view. */
  costByEnvironment: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        range: rangeSchema,
      })
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ ctx, input }) => {
      // Get all environments the user can see in their teams
      const userId = ctx.session!.user!.id!;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isSuperAdmin: true },
      });

      let envFilter: Record<string, unknown> = {};
      if (!user?.isSuperAdmin) {
        const memberships = await prisma.teamMember.findMany({
          where: { userId },
          select: { teamId: true },
        });
        envFilter = { teamId: { in: memberships.map((m) => m.teamId) } };
      }

      const environments = await prisma.environment.findMany({
        where: { isSystem: false, ...envFilter },
        select: { id: true },
      });

      return getCostByEnvironment({
        environmentIds: environments.map((e) => e.id),
        range: input.range,
      });
    }),

  /** Volume trend time series for chart. */
  costTimeSeries: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        range: rangeSchema,
        groupBy: z.enum(["pipeline", "team"]).default("pipeline"),
      })
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
        select: { costPerGbCents: true },
      });
      if (!env) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
      }

      return getCostTimeSeries({
        environmentId: input.environmentId,
        range: input.range,
        costPerGbCents: env.costPerGbCents,
        groupBy: input.groupBy,
      });
    }),

  /** Generate CSV for cost export. */
  costCsv: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        range: rangeSchema,
      })
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
        select: { costPerGbCents: true },
      });
      if (!env) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
      }

      const rows = await getCostByPipeline({
        environmentId: input.environmentId,
        range: input.range,
        costPerGbCents: env.costPerGbCents,
      });

      return { csv: formatCostCsv(rows) };
    }),

  /**
   * Cost snapshot for a single pipeline over the trailing 24 hours. Used by
   * the deploy dialog to surface what the pipeline currently costs before the
   * user confirms a deploy.
   */
  pipelineCostSnapshot: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        select: {
          environmentId: true,
          environment: { select: { costPerGbCents: true } },
        },
      });
      if (!pipeline) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
      }

      const snapshot = await getPipelineCostSnapshot(
        input.pipelineId,
        pipeline.environment.costPerGbCents,
        "1d",
      );
      return {
        ...snapshot,
        costPerGbCents: pipeline.environment.costPerGbCents,
      };
    }),
});
