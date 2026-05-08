import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
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
        from: z.string().optional(),
        to: z.string().optional(),
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
    .input(z.object({ environmentId: z.string(), anomalyId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ ctx, input }) => {
      const anomaly = await prisma.anomalyEvent.findUnique({
        where: { id: input.anomalyId },
        select: { environmentId: true },
      });
      if (!anomaly || anomaly.environmentId !== input.environmentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Anomaly not found" });
      }
      return acknowledgeAnomaly(input.anomalyId, ctx.session.user.id!);
    }),

  // ─── Dismiss an anomaly ────────────────────────────────────────────────

  dismiss: protectedProcedure
    .input(z.object({ environmentId: z.string(), anomalyId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ ctx, input }) => {
      const anomaly = await prisma.anomalyEvent.findUnique({
        where: { id: input.anomalyId },
        select: { environmentId: true },
      });
      if (!anomaly || anomaly.environmentId !== input.environmentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Anomaly not found" });
      }
      return dismissAnomaly(input.anomalyId, ctx.session.user.id!);
    }),
});
