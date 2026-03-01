import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import { generateEnrollmentToken } from "@/server/services/agent-token";

export const environmentRouter = router({
  list: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.environment.findMany({
        where: { teamId: input.teamId },
        select: {
          id: true,
          name: true,
          teamId: true,
          createdAt: true,
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

      return {
        ...environment,
        hasEnrollmentToken: !!environment.enrollmentTokenHash,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        teamId: z.string(),
      })
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("environment.created", "Environment"))
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
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        secretBackend: z.enum(["BUILTIN", "VAULT", "AWS_SM", "EXEC"]).optional(),
        secretBackendConfig: z.any().optional(),
      })
    )
    .use(withAudit("environment.updated", "Environment"))
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
    .use(withAudit("environment.deleted", "Environment"))
    .mutation(async ({ input }) => {
      const existing = await prisma.environment.findUnique({
        where: { id: input.id },
        include: { pipelines: { select: { id: true } } },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }
      const pipelineIds = existing.pipelines.map((p) => p.id);
      return prisma.$transaction([
        // PipelineVersion lacks onDelete: Cascade, clean up explicitly
        prisma.pipelineVersion.deleteMany({ where: { pipelineId: { in: pipelineIds } } }),
        prisma.pipeline.deleteMany({ where: { environmentId: input.id } }),
        prisma.vectorNode.deleteMany({ where: { environmentId: input.id } }),
        prisma.environment.delete({ where: { id: input.id } }),
      ]);
    }),

  generateEnrollmentToken: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("environment.enrollmentToken.generated", "Environment"))
    .mutation(async ({ input }) => {
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
      });
      if (!env) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
      }
      const { token, hash, hint } = await generateEnrollmentToken();
      await prisma.environment.update({
        where: { id: input.environmentId },
        data: {
          enrollmentTokenHash: hash,
          enrollmentTokenHint: hint,
        },
      });

      return { token, hint };
    }),

  revokeEnrollmentToken: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("environment.enrollmentToken.revoked", "Environment"))
    .mutation(async ({ input }) => {
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
      });
      if (!env) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
      }

      await prisma.environment.update({
        where: { id: input.environmentId },
        data: {
          enrollmentTokenHash: null,
          enrollmentTokenHint: null,
        },
      });

      return { success: true };
    }),
});
