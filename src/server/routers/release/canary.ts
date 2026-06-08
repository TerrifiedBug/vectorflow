import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { stagedRolloutService } from "@/server/services/staged-rollout";
import { writeAuditLog } from "@/server/services/audit";
import { getReplayJob } from "@/server/services/lake/replay";
import { evaluateReplayValidation } from "@/server/services/lake/replay-validation";

export const canaryReleaseRouter = router({
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
    .input(
      z.object({
        rolloutId: z.string(),
        /** Optional NF-6 gate: a completed replay whose target is this
         *  rollout's pipeline. When present, a FAILED error-budget verdict
         *  blocks the broaden unless `force` is set. Absent → no gate. */
        replayJobId: z.string().optional(),
        force: z.boolean().optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input, ctx }) => {
      // Fetch rollout to get pipelineId for audit log
      const rollout = await prisma.release.findFirst({
        where: { id: input.rolloutId, strategy: "CANARY" },
        select: { pipelineId: true, pipeline: { select: { environmentId: true } } },
      });

      // NF-6: gate canary -> full-fleet broaden on the candidate's replay
      // error-budget when the caller opts in. With no replayJobId this is a
      // no-op and broaden behaves exactly as before.
      let replayValidation: { verdict: string; overridden: boolean } | null = null;
      if (input.replayJobId && rollout) {
        const job = await getReplayJob({ orgId: ctx.organizationId, jobId: input.replayJobId });
        if (!job || job.targetPipelineId !== rollout.pipelineId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Replay job does not target this rollout's pipeline",
          });
        }
        const result = await evaluateReplayValidation({
          targetPipelineId: job.targetPipelineId,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
        });
        const overridden = result.verdict === "FAIL" && input.force === true;
        if (result.verdict === "FAIL" && !overridden) {
          const breached = result.slis
            .filter((s) => s.status === "breached")
            .map((s) => s.metric)
            .join(", ");
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Replay validation failed${breached ? ` (breached: ${breached})` : ""}. Re-run the canary replay or pass force to override.`,
          });
        }
        replayValidation = { verdict: result.verdict, overridden };
      }

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
            ...(replayValidation ? { replayValidation } : {}),
          },
          teamId: (ctx as Record<string, unknown>).teamId as string | null ?? null,
          environmentId: rollout.pipeline.environmentId,
          ipAddress: (ctx as Record<string, unknown>).ipAddress as string | null ?? null,
          userEmail: ctx.session?.user?.email ?? null,
          userName: ctx.session?.user?.name ?? null,
        }).catch(() => {});
      }

      return replayValidation ? { success: true, replayValidation } : { success: true };
    }),

  rollback: protectedProcedure
    .input(z.object({ rolloutId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input, ctx }) => {
      // Fetch rollout to get pipelineId for audit log
      const rollout = await prisma.release.findFirst({
        where: { id: input.rolloutId, strategy: "CANARY" },
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
      const rollout = await prisma.release.findFirst({
        where: {
          pipelineId: input.pipelineId,
          status: { in: ["CANARY_DEPLOYED", "HEALTH_CHECK"] },
          strategy: "CANARY",
        },
        include: {
          canaryVersion: {
            select: { id: true, version: true, changelog: true },
          },
          previousVersion: {
            select: { id: true, version: true },
          },
          requestedBy: {
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
      return prisma.release.findMany({
        where: { pipelineId: input.pipelineId, strategy: "CANARY" },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          canaryVersion: {
            select: { id: true, version: true, changelog: true },
          },
          previousVersion: {
            select: { id: true, version: true },
          },
          requestedBy: {
            select: { name: true, email: true },
          },
        },
      });
    }),
});
