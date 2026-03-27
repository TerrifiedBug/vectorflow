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
          _count: { select: { pipelines: true, children: true } },
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
        parentId: z.string().optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipelineGroup.created", "PipelineGroup"))
    .mutation(async ({ input }) => {
      // Check duplicate name under same parent (application-layer uniqueness)
      const existing = await prisma.pipelineGroup.findFirst({
        where: {
          environmentId: input.environmentId,
          name: input.name,
          parentId: input.parentId ?? null,
        },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A group named "${input.name}" already exists ${input.parentId ? "in this parent group" : "at the root level"}`,
        });
      }

      // Enforce max 3-level nesting depth
      if (input.parentId) {
        const parent = await prisma.pipelineGroup.findUnique({
          where: { id: input.parentId },
          select: { parentId: true, parent: { select: { parentId: true } } },
        });
        if (!parent) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Parent group not found" });
        }
        // If parent has a grandparent that also has a parent, depth would exceed 3
        if (parent.parentId !== null && parent.parent?.parentId !== null && parent.parent?.parentId !== undefined) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Maximum group nesting depth (3) exceeded",
          });
        }
      }

      return prisma.pipelineGroup.create({
        data: {
          name: input.name,
          color: input.color,
          environmentId: input.environmentId,
          parentId: input.parentId ?? null,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        color: z.string().max(20).nullable().optional(),
        parentId: z.string().nullable().optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipelineGroup.updated", "PipelineGroup"))
    .mutation(async ({ input }) => {
      const group = await prisma.pipelineGroup.findUnique({
        where: { id: input.id },
        select: { id: true, environmentId: true, name: true, parentId: true },
      });
      if (!group) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline group not found",
        });
      }

      // Validate unique name if name is being changed
      if (input.name && input.name !== group.name) {
        const targetParentId = input.parentId !== undefined ? input.parentId : group.parentId;
        const existingGroup = await prisma.pipelineGroup.findFirst({
          where: {
            environmentId: group.environmentId,
            name: input.name,
            parentId: targetParentId,
            id: { not: input.id },
          },
        });
        if (existingGroup) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A group named "${input.name}" already exists in this location`,
          });
        }
      }

      // Enforce depth guard when parentId changes
      if (input.parentId !== undefined && input.parentId !== group.parentId) {
        if (input.parentId !== null) {
          const parent = await prisma.pipelineGroup.findUnique({
            where: { id: input.parentId },
            select: { parentId: true, parent: { select: { parentId: true } } },
          });
          if (!parent) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Parent group not found" });
          }
          if (parent.parentId !== null && parent.parent?.parentId !== null && parent.parent?.parentId !== undefined) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Maximum group nesting depth (3) exceeded",
            });
          }
        }
      }

      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.color !== undefined) data.color = input.color;
      if (input.parentId !== undefined) data.parentId = input.parentId;

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

      // Prisma onDelete:SetNull automatically sets children parentId to null
      return prisma.pipelineGroup.delete({
        where: { id: input.id },
      });
    }),
});
