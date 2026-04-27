import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess, denyInDemo } from "@/trpc/init";
import { prisma } from "@/lib/prisma";

export const gitSyncRouter = router({
  /** Get sync status summary for an environment. */
  status: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
        select: {
          id: true,
          gitRepoUrl: true,
          gitBranch: true,
          gitOpsMode: true,
          gitProvider: true,
        },
      });

      if (!env) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
      }

      // Count pending and failed jobs
      const [pendingCount, failedCount, lastCompleted, lastFailed] = await Promise.all([
        prisma.gitSyncJob.count({
          where: { environmentId: input.environmentId, status: "pending" },
        }),
        prisma.gitSyncJob.count({
          where: { environmentId: input.environmentId, status: "failed" },
        }),
        prisma.gitSyncJob.findFirst({
          where: { environmentId: input.environmentId, status: "completed" },
          orderBy: { completedAt: "desc" },
          select: { completedAt: true },
        }),
        prisma.gitSyncJob.findFirst({
          where: { environmentId: input.environmentId, status: "failed" },
          orderBy: { completedAt: "desc" },
          select: { lastError: true, completedAt: true },
        }),
      ]);

      return {
        gitRepoUrl: env.gitRepoUrl,
        gitBranch: env.gitBranch,
        gitOpsMode: env.gitOpsMode,
        gitProvider: env.gitProvider,
        pendingCount,
        failedCount,
        lastSuccessfulSync: lastCompleted?.completedAt ?? null,
        lastError: lastFailed?.lastError ?? null,
        lastErrorAt: lastFailed?.completedAt ?? null,
      };
    }),

  /** List recent sync jobs for an environment. */
  jobs: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        status: z.enum(["pending", "completed", "failed"]).optional(),
        limit: z.number().min(1).max(100).default(25),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.gitSyncJob.findMany({
        where: {
          environmentId: input.environmentId,
          ...(input.status ? { status: input.status } : {}),
        },
        include: {
          pipeline: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: input.limit,
      });
    }),

  /** Retry all failed jobs for an environment. */
  retryAllFailed: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(denyInDemo())
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input }) => {
      const now = new Date();
      const result = await prisma.gitSyncJob.updateMany({
        where: {
          environmentId: input.environmentId,
          status: "failed",
        },
        data: {
          status: "pending",
          nextRetryAt: now,
          attempts: 0,
        },
      });

      return { retriedCount: result.count };
    }),

  /** Retry a single failed job. */
  retryJob: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .use(denyInDemo())
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input }) => {
      const job = await prisma.gitSyncJob.findUnique({
        where: { id: input.jobId },
        select: { status: true },
      });

      if (!job || job.status !== "failed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Job is not in failed state",
        });
      }

      await prisma.gitSyncJob.update({
        where: { id: input.jobId },
        data: {
          status: "pending",
          nextRetryAt: new Date(),
          attempts: 0,
        },
      });

      return { success: true };
    }),

  /** Get import errors from audit log. */
  importErrors: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        limit: z.number().min(1).max(50).default(10),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.auditLog.findMany({
        where: {
          environmentId: input.environmentId,
          action: "gitops.pipeline.import_failed",
        },
        select: {
          id: true,
          metadata: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: input.limit,
      });
    }),
});
