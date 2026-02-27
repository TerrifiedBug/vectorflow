import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "@/trpc/init";
import { prisma } from "@/lib/prisma";

export const environmentRouter = router({
  list: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .query(async ({ input }) => {
      return prisma.environment.findMany({
        where: { teamId: input.teamId },
        include: {
          _count: { select: { nodes: true, pipelines: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const environment = await prisma.environment.findUnique({
        where: { id: input.id },
        include: {
          nodes: true,
          _count: { select: { nodes: true, pipelines: true } },
          team: { select: { id: true, name: true } },
        },
      });
      if (!environment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }
      return environment;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        teamId: z.string(),
        deployMode: z.enum(["API_RELOAD", "GITOPS"]),
        gitRepo: z.string().optional(),
        gitBranch: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Verify team exists
      const team = await prisma.team.findUnique({
        where: { id: input.teamId },
      });
      if (!team) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Team not found",
        });
      }

      return prisma.environment.create({
        data: {
          name: input.name,
          teamId: input.teamId,
          deployMode: input.deployMode,
          gitRepo: input.gitRepo,
          gitBranch: input.gitBranch,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        deployMode: z.enum(["API_RELOAD", "GITOPS"]).optional(),
        gitRepo: z.string().nullable().optional(),
        gitBranch: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const existing = await prisma.environment.findUnique({
        where: { id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }
      return prisma.environment.update({
        where: { id },
        data,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const existing = await prisma.environment.findUnique({
        where: { id: input.id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }
      return prisma.environment.delete({
        where: { id: input.id },
      });
    }),
});
