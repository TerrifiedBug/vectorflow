import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";

export const nodeGroupRouter = router({
  list: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.nodeGroup.findMany({
        where: { environmentId: input.environmentId },
        orderBy: { name: "asc" },
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        name: z.string().min(1).max(100),
        criteria: z.record(z.string(), z.string()).default({}),
        labelTemplate: z.record(z.string(), z.string()).default({}),
        requiredLabels: z.array(z.string()).default([]),
      }),
    )
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("nodeGroup.created", "NodeGroup"))
    .mutation(async ({ input }) => {
      // Validate unique name per environment
      const existing = await prisma.nodeGroup.findUnique({
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
          message: `A node group named "${input.name}" already exists in this environment`,
        });
      }

      return prisma.nodeGroup.create({
        data: {
          name: input.name,
          environmentId: input.environmentId,
          criteria: input.criteria,
          labelTemplate: input.labelTemplate,
          requiredLabels: input.requiredLabels,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        criteria: z.record(z.string(), z.string()).optional(),
        labelTemplate: z.record(z.string(), z.string()).optional(),
        requiredLabels: z.array(z.string()).optional(),
      }),
    )
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("nodeGroup.updated", "NodeGroup"))
    .mutation(async ({ input }) => {
      const group = await prisma.nodeGroup.findUnique({
        where: { id: input.id },
        select: { id: true, environmentId: true, name: true },
      });
      if (!group) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Node group not found",
        });
      }

      // Validate unique name if name is being changed
      if (input.name && input.name !== group.name) {
        const existing = await prisma.nodeGroup.findUnique({
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
            message: `A node group named "${input.name}" already exists in this environment`,
          });
        }
      }

      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.criteria !== undefined) data.criteria = input.criteria;
      if (input.labelTemplate !== undefined) data.labelTemplate = input.labelTemplate;
      if (input.requiredLabels !== undefined) data.requiredLabels = input.requiredLabels;

      return prisma.nodeGroup.update({
        where: { id: input.id },
        data,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("nodeGroup.deleted", "NodeGroup"))
    .mutation(async ({ input }) => {
      const group = await prisma.nodeGroup.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (!group) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Node group not found",
        });
      }

      return prisma.nodeGroup.delete({
        where: { id: input.id },
      });
    }),
});
