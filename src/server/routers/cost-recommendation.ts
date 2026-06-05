import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { withAudit } from "@/server/middleware/audit";
import { prisma } from "@/lib/prisma";
import {
  listRecommendations,
  dismissRecommendation,
  markRecommendationApplied,
  enrichRecommendationsWithCost,
} from "@/server/services/cost-recommendations";
import {
  previewRecommendation,
  applyRecommendation,
  simulateTransform,
} from "@/server/services/cost-recommendation-procedures";
import { runDailyCostAnalysisForOrg } from "@/server/services/cost-optimizer-scheduler";

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
    .query(async ({ input, ctx }) => {
      const recs = await listRecommendations({
        environmentId: input.environmentId,
        status: input.status as "PENDING" | "DISMISSED" | "APPLIED" | undefined,
        limit: input.limit,
      });
      // Attach projected $ savings (estimatedSavingsCents) per the org's
      // DestinationCostModel; null per-rec when the sink is unpriced.
      return enrichRecommendationsWithCost(recs, ctx.organizationId);
    }),

  /** Get a single recommendation by ID. */
  getById: protectedProcedure
    .input(z.object({ environmentId: z.string(), id: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input, ctx }) => {
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

      const [enriched] = await enrichRecommendationsWithCost([rec], ctx.organizationId);
      return enriched;
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

  /** Preview the YAML diff that would result from applying a recommendation. */
  previewApply: protectedProcedure
    .input(z.object({ environmentId: z.string(), id: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return previewRecommendation(input.id, input.environmentId);
    }),

  /**
   * What-if simulator: project a transform's reduction (and $ saving) against
   * the pipeline's most recent sampled events BEFORE applying. Either pass a
   * recommendation `id` (uses its suggested transform) or a `pipelineId` with a
   * caller-supplied `vrl`. Read-only; runs the VRL via the eval harness.
   */
  simulate: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        id: z.string().optional(),
        pipelineId: z.string().optional(),
        vrl: z.string().max(50_000).optional(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input, ctx }) => {
      return simulateTransform({
        environmentId: input.environmentId,
        organizationId: ctx.organizationId,
        recommendationId: input.id,
        pipelineId: input.pipelineId,
        vrl: input.vrl,
      });
    }),

  /** Apply a recommendation by creating a new pipeline version (or disabling the pipeline). */
  applyRecommendation: protectedProcedure
    .input(z.object({ environmentId: z.string(), id: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("costRecommendation.apply", "Pipeline"))
    .mutation(async ({ input, ctx }) => {
      return applyRecommendation(input.id, ctx.session.user!.id!, input.environmentId);
    }),

  /** Summary stats for the recommendation cards header. */
  summary: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input, ctx }) => {
      const [pending, totalSavings, pendingRecs] = await Promise.all([
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
        prisma.costRecommendation.findMany({
          where: {
            environmentId: input.environmentId,
            status: "PENDING",
            expiresAt: { gt: new Date() },
            estimatedSavingsBytes: { not: null },
          },
          select: { pipelineId: true, estimatedSavingsBytes: true },
        }),
      ]);

      // Project total $ savings across pending recs; null when no sink is
      // priced (byte-only org).
      const enriched = await enrichRecommendationsWithCost(
        pendingRecs,
        ctx.organizationId,
      );
      const anyPriced = enriched.some((r) => r.estimatedSavingsCents != null);
      const estimatedSavingsCents = anyPriced
        ? enriched.reduce((sum, r) => sum + (r.estimatedSavingsCents ?? 0), 0)
        : null;

      return {
        pendingCount: pending,
        estimatedSavingsBytes: totalSavings._sum.estimatedSavingsBytes ?? BigInt(0),
        estimatedSavingsCents,
      };
    }),

  /** Manually trigger a cost analysis run (admin only). Scoped to the env's org. */
  triggerAnalysis: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("cost_recommendation.trigger_analysis", "Environment"))
    .mutation(async ({ input, ctx }) => {
      // Resolve the env's organization so the analysis is scoped to it.
      // Falls back to ctx.organizationId for safety; fails fast if neither
      // is available.
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
        select: { organizationId: true },
      });
      const orgId = env?.organizationId ?? ctx.organizationId;
      if (!orgId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot resolve organization for analysis trigger",
        });
      }
      return runDailyCostAnalysisForOrg(orgId);
    }),
});
