import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";

export const pipelineGroupRouter = router({
  list: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.pipelineGroup.findMany({
        where: { environmentId: input.environmentId },
        include: {
          _count: { select: { pipelines: true } },
        },
        orderBy: { name: "asc" },
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        name: z.string().min(1).max(100),
        color: z.string().max(20).optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipelineGroup.created", "PipelineGroup"))
    .mutation(async ({ input }) => {
      // Validate unique name per environment
      const existing = await prisma.pipelineGroup.findUnique({
        where: {
          environmentId_name: {
            environmentId: input.environmentId,
            name: input.name,
          },
        },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A group named "${input.name}" already exists in this environment`,
        });
      }

      return prisma.pipelineGroup.create({
        data: {
          name: input.name,
          color: input.color,
          environmentId: input.environmentId,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        color: z.string().max(20).nullable().optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipelineGroup.updated", "PipelineGroup"))
    .mutation(async ({ input }) => {
      const group = await prisma.pipelineGroup.findUnique({
        where: { id: input.id },
        select: { id: true, environmentId: true, name: true },
      });
      if (!group) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline group not found",
        });
      }

      // Validate unique name if name is being changed
      if (input.name && input.name !== group.name) {
        const existing = await prisma.pipelineGroup.findUnique({
          where: {
            environmentId_name: {
              environmentId: group.environmentId,
              name: input.name,
            },
          },
        });
        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A group named "${input.name}" already exists in this environment`,
          });
        }
      }

      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.color !== undefined) data.color = input.color;

      return prisma.pipelineGroup.update({
        where: { id: input.id },
        data,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("pipelineGroup.deleted", "PipelineGroup"))
    .mutation(async ({ input }) => {
      const group = await prisma.pipelineGroup.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (!group) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline group not found",
        });
      }

      // Prisma onDelete:SetNull automatically unassigns all pipelines
      return prisma.pipelineGroup.delete({
        where: { id: input.id },
      });
    }),
});
