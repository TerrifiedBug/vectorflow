import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { withAudit } from "@/server/middleware/audit";
import { prisma } from "@/lib/prisma";
import {
  listRecommendations,
  dismissRecommendation,
  markRecommendationApplied,
} from "@/server/services/cost-recommendations";
import { runDailyCostAnalysis } from "@/server/services/cost-optimizer-scheduler";

export const costRecommendationRouter = router({
  /** List pending recommendations for the current environment. */
  list: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        status: z.enum(["PENDING", "DISMISSED", "APPLIED"]).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return listRecommendations({
        environmentId: input.environmentId,
        status: input.status as "PENDING" | "DISMISSED" | "APPLIED" | undefined,
        limit: input.limit,
      });
    }),

  /** Get a single recommendation by ID. */
  getById: protectedProcedure
    .input(z.object({ environmentId: z.string(), id: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const rec = await prisma.costRecommendation.findUnique({
        where: { id: input.id },
        include: {
          pipeline: {
            select: {
              id: true,
              name: true,
              environmentId: true,
              nodes: {
                select: {
                  componentKey: true,
                  componentType: true,
                  kind: true,
                  config: true,
                  positionX: true,
                  positionY: true,
                },
              },
            },
          },
          dismissedBy: { select: { id: true, name: true } },
        },
      });

      if (!rec || rec.environmentId !== input.environmentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Recommendation not found" });
      }

      return rec;
    }),

  /** Dismiss a recommendation (marks it as not actionable). */
  dismiss: protectedProcedure
    .input(z.object({ environmentId: z.string(), id: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("cost_recommendation.dismiss", "CostRecommendation"))
    .mutation(async ({ input, ctx }) => {
      const rec = await prisma.costRecommendation.findUnique({
        where: { id: input.id },
        select: { environmentId: true, status: true },
      });

      if (!rec || rec.environmentId !== input.environmentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Recommendation not found" });
      }

      if (rec.status !== "PENDING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot dismiss a recommendation with status "${rec.status}"`,
        });
      }

      return dismissRecommendation(input.id, ctx.session.user!.id!);
    }),

  /** Mark a recommendation as applied (after the user modifies the pipeline). */
  markApplied: protectedProcedure
    .input(z.object({ environmentId: z.string(), id: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("cost_recommendation.apply", "CostRecommendation"))
    .mutation(async ({ input }) => {
      const rec = await prisma.costRecommendation.findUnique({
        where: { id: input.id },
        select: { environmentId: true, status: true },
      });

      if (!rec || rec.environmentId !== input.environmentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Recommendation not found" });
      }

      if (rec.status !== "PENDING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot apply a recommendation with status "${rec.status}"`,
        });
      }

      return markRecommendationApplied(input.id);
    }),

  /** Summary stats for the recommendation cards header. */
  summary: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const [pending, totalSavings] = await Promise.all([
        prisma.costRecommendation.count({
          where: {
            environmentId: input.environmentId,
            status: "PENDING",
            expiresAt: { gt: new Date() },
          },
        }),
        prisma.costRecommendation.aggregate({
          where: {
            environmentId: input.environmentId,
            status: "PENDING",
            expiresAt: { gt: new Date() },
            estimatedSavingsBytes: { not: null },
          },
          _sum: { estimatedSavingsBytes: true },
        }),
      ]);

      return {
        pendingCount: pending,
        estimatedSavingsBytes: totalSavings._sum.estimatedSavingsBytes ?? BigInt(0),
      };
    }),

  /** Manually trigger a cost analysis run (admin only). */
  triggerAnalysis: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("cost_recommendation.trigger_analysis", "Environment"))
    .mutation(async () => {
      return runDailyCostAnalysis();
    }),
});
