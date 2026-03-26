import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { stagedRolloutService } from "@/server/services/staged-rollout";

export const stagedRolloutRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        canarySelector: z.record(z.string(), z.string()),
        healthCheckWindowMinutes: z.number().int().positive().max(60).default(5),
        changelog: z.string().min(1),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      return stagedRolloutService.createRollout(
        input.pipelineId,
        userId,
        input.canarySelector,
        input.healthCheckWindowMinutes,
        input.changelog,
      );
    }),

  broaden: protectedProcedure
    .input(z.object({ rolloutId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input }) => {
      await stagedRolloutService.broadenRollout(input.rolloutId);
      return { success: true };
    }),

  rollback: protectedProcedure
    .input(z.object({ rolloutId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input }) => {
      await stagedRolloutService.rollbackRollout(input.rolloutId);
      return { success: true };
    }),

  getActive: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const rollout = await prisma.stagedRollout.findFirst({
        where: {
          pipelineId: input.pipelineId,
          status: { in: ["CANARY_DEPLOYED", "HEALTH_CHECK"] },
        },
        include: {
          canaryVersion: {
            select: { id: true, version: true, changelog: true },
          },
          previousVersion: {
            select: { id: true, version: true },
          },
          createdBy: {
            select: { name: true, email: true },
          },
        },
      });
      return rollout;
    }),

  list: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.stagedRollout.findMany({
        where: { pipelineId: input.pipelineId },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          canaryVersion: {
            select: { id: true, version: true, changelog: true },
          },
          previousVersion: {
            select: { id: true, version: true },
          },
          createdBy: {
            select: { name: true, email: true },
          },
        },
      });
    }),
});
