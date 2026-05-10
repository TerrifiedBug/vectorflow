import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess, denyInDemo } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";

const variableSelect = {
  id: true,
  name: true,
  value: true,
  description: true,
  createdAt: true,
  updatedAt: true,
};

export const variableRouter = router({
  list: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.variable.findMany({
        where: { environmentId: input.environmentId },
        select: variableSelect,
        orderBy: { name: "asc" },
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        name: z.string().min(1).max(100).regex(
          /^[a-zA-Z][a-zA-Z0-9_]*$/,
          "Variable name must start with a letter and contain only letters, numbers, and underscores",
        ),
        value: z.string().min(1),
        description: z.string().max(500).optional(),
      }),
    )
    .use(denyInDemo())
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("variable.created", "Variable"))
    .mutation(async ({ input }) => {
      const existing = await prisma.variable.findUnique({
        where: { environmentId_name: { environmentId: input.environmentId, name: input.name } },
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "A variable with this name already exists in this environment" });
      }
      return prisma.variable.create({
        data: {
          name: input.name,
          value: input.value,
          description: input.description,
          environmentId: input.environmentId,
        },
        select: variableSelect,
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        environmentId: z.string(),
        value: z.string().min(1).optional(),
        description: z.string().max(500).nullable().optional(),
      }),
    )
    .use(denyInDemo())
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("variable.updated", "Variable"))
    .mutation(async ({ input }) => {
      const variable = await prisma.variable.findUnique({ where: { id: input.id } });
      if (!variable || variable.environmentId !== input.environmentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Variable not found" });
      }
      return prisma.variable.update({
        where: { id: input.id },
        data: {
          ...(input.value !== undefined ? { value: input.value } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
        select: { id: true, name: true, value: true, description: true, updatedAt: true },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string(), environmentId: z.string() }))
    .use(denyInDemo())
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("variable.deleted", "Variable"))
    .mutation(async ({ input }) => {
      const variable = await prisma.variable.findUnique({ where: { id: input.id } });
      if (!variable || variable.environmentId !== input.environmentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Variable not found" });
      }
      await prisma.variable.delete({ where: { id: input.id } });
      return { deleted: true };
    }),
});
