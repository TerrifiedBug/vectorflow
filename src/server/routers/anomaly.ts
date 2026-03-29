import { z } from "zod";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import {
  listAnomalies,
  acknowledgeAnomaly,
  dismissAnomaly,
  countOpenAnomalies,
  getMaxSeverityByPipeline,
} from "@/server/services/anomaly-event-manager";

export const anomalyRouter = router({
  // ─── List anomalies ───────────────────────────────────────────────────

  list: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        pipelineId: z.string().optional(),
        status: z.enum(["open", "acknowledged", "dismissed"]).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return listAnomalies(input);
    }),

  // ─── Count open anomalies per pipeline ─────────────────────────────────

  countByPipeline: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return countOpenAnomalies(input.environmentId);
    }),

  // ─── Max severity per pipeline ─────────────────────────────────────────

  maxSeverityByPipeline: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return getMaxSeverityByPipeline(input.environmentId);
    }),

  // ─── Acknowledge an anomaly ────────────────────────────────────────────

  acknowledge: protectedProcedure
    .input(z.object({ anomalyId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id!;
      return acknowledgeAnomaly(input.anomalyId, userId);
    }),

  // ─── Dismiss an anomaly ────────────────────────────────────────────────

  dismiss: protectedProcedure
    .input(z.object({ anomalyId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id!;
      return dismissAnomaly(input.anomalyId, userId);
    }),
});
