import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { stagedRolloutService } from "@/server/services/staged-rollout";
import { writeAuditLog } from "@/server/services/audit";

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

      const result = await stagedRolloutService.createRollout(
        input.pipelineId,
        userId,
        input.canarySelector,
        input.healthCheckWindowMinutes,
        input.changelog,
      );

      // Fetch pipeline to get environmentId for audit log
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        select: { environmentId: true },
      });

      writeAuditLog({
        userId,
        action: "deploy.staged_created",
        entityType: "Pipeline",
        entityId: input.pipelineId,
        metadata: {
          timestamp: new Date().toISOString(),
          input: {
            pipelineId: input.pipelineId,
            changelog: input.changelog,
            canarySelector: input.canarySelector,
            healthCheckWindowMinutes: input.healthCheckWindowMinutes,
          },
          rolloutId: result.rolloutId,
        },
        teamId: (ctx as Record<string, unknown>).teamId as string | null ?? null,
        environmentId: pipeline?.environmentId ?? null,
        ipAddress: (ctx as Record<string, unknown>).ipAddress as string | null ?? null,
        userEmail: ctx.session?.user?.email ?? null,
        userName: ctx.session?.user?.name ?? null,
      }).catch(() => {});

      return result;
    }),

  broaden: protectedProcedure
    .input(z.object({ rolloutId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input, ctx }) => {
      // Fetch rollout to get pipelineId for audit log
      const rollout = await prisma.stagedRollout.findUnique({
        where: { id: input.rolloutId },
        select: { pipelineId: true, pipeline: { select: { environmentId: true } } },
      });

      await stagedRolloutService.broadenRollout(input.rolloutId);

      if (rollout) {
        const userId = ctx.session.user?.id ?? null;
        writeAuditLog({
          userId,
          action: "deploy.staged_broadened",
          entityType: "Pipeline",
          entityId: rollout.pipelineId,
          metadata: {
            timestamp: new Date().toISOString(),
            rolloutId: input.rolloutId,
          },
          teamId: (ctx as Record<string, unknown>).teamId as string | null ?? null,
          environmentId: rollout.pipeline.environmentId,
          ipAddress: (ctx as Record<string, unknown>).ipAddress as string | null ?? null,
          userEmail: ctx.session?.user?.email ?? null,
          userName: ctx.session?.user?.name ?? null,
        }).catch(() => {});
      }

      return { success: true };
    }),

  rollback: protectedProcedure
    .input(z.object({ rolloutId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input, ctx }) => {
      // Fetch rollout to get pipelineId for audit log
      const rollout = await prisma.stagedRollout.findUnique({
        where: { id: input.rolloutId },
        select: { pipelineId: true, pipeline: { select: { environmentId: true } } },
      });

      await stagedRolloutService.rollbackRollout(input.rolloutId);

      if (rollout) {
        const userId = ctx.session.user?.id ?? null;
        writeAuditLog({
          userId,
          action: "deploy.staged_rolled_back",
          entityType: "Pipeline",
          entityId: rollout.pipelineId,
          metadata: {
            timestamp: new Date().toISOString(),
            rolloutId: input.rolloutId,
          },
          teamId: (ctx as Record<string, unknown>).teamId as string | null ?? null,
          environmentId: rollout.pipeline.environmentId,
          ipAddress: (ctx as Record<string, unknown>).ipAddress as string | null ?? null,
          userEmail: ctx.session?.user?.email ?? null,
          userName: ctx.session?.user?.name ?? null,
        }).catch(() => {});
      }

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
