import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { withAudit } from "@/server/middleware/audit";
import { prisma } from "@/lib/prisma";

const MAX_PRESETS_PER_SCOPE = 20;

const scopeSchema = z.enum(["pipeline_list", "fleet_matrix"]);

export const filterPresetRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        scope: scopeSchema,
      })
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.filterPreset.findMany({
        where: {
          environmentId: input.environmentId,
          scope: input.scope,
        },
        orderBy: { createdAt: "asc" },
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        name: z.string().min(1).max(50),
        scope: scopeSchema,
        filters: z.record(z.string(), z.unknown()),
        isDefault: z.boolean().default(false),
      })
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("filterPreset.create", "FilterPreset"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user!.id!;

      const count = await prisma.filterPreset.count({
        where: {
          environmentId: input.environmentId,
          scope: input.scope,
        },
      });

      if (count >= MAX_PRESETS_PER_SCOPE) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Maximum ${MAX_PRESETS_PER_SCOPE} presets per scope reached`,
        });
      }

      // If setting as default, clear existing default first
      if (input.isDefault) {
        await prisma.filterPreset.updateMany({
          where: {
            environmentId: input.environmentId,
            scope: input.scope,
            isDefault: true,
          },
          data: { isDefault: false },
        });
      }

      return prisma.filterPreset.create({
        data: {
          name: input.name,
          environmentId: input.environmentId,
          scope: input.scope,
          filters: input.filters,
          isDefault: input.isDefault,
          createdById: userId,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        id: z.string(),
        name: z.string().min(1).max(50).optional(),
        filters: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("filterPreset.update", "FilterPreset"))
    .mutation(async ({ input }) => {
      const existing = await prisma.filterPreset.findUnique({
        where: { id: input.id },
      });

      if (!existing || existing.environmentId !== input.environmentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Filter preset not found" });
      }

      const { id, environmentId: _envId, ...data } = input;
      return prisma.filterPreset.update({ where: { id }, data });
    }),

  delete: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        id: z.string(),
      })
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("filterPreset.delete", "FilterPreset"))
    .mutation(async ({ input }) => {
      const existing = await prisma.filterPreset.findUnique({
        where: { id: input.id },
      });

      if (!existing || existing.environmentId !== input.environmentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Filter preset not found" });
      }

      await prisma.filterPreset.delete({ where: { id: input.id } });
      return { deleted: true };
    }),

  setDefault: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        id: z.string(),
        scope: scopeSchema,
      })
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("filterPreset.setDefault", "FilterPreset"))
    .mutation(async ({ input }) => {
      const existing = await prisma.filterPreset.findUnique({
        where: { id: input.id },
      });

      if (!existing || existing.environmentId !== input.environmentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Filter preset not found" });
      }

      // Wrap in transaction to prevent race conditions with concurrent default-setting
      return prisma.$transaction(async (tx) => {
        // Clear existing default for this scope
        await tx.filterPreset.updateMany({
          where: {
            environmentId: input.environmentId,
            scope: input.scope,
            isDefault: true,
          },
          data: { isDefault: false },
        });

        return tx.filterPreset.update({
          where: { id: input.id },
          data: { isDefault: true },
        });
      });
    }),

  clearDefault: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        scope: scopeSchema,
      })
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("filterPreset.clearDefault", "FilterPreset"))
    .mutation(async ({ input }) => {
      await prisma.filterPreset.updateMany({
        where: {
          environmentId: input.environmentId,
          scope: input.scope,
          isDefault: true,
        },
        data: { isDefault: false },
      });
      return { cleared: true };
    }),
});
