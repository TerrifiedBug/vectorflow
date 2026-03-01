import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/server/services/crypto";
import { withAudit } from "@/server/middleware/audit";

export const secretRouter = router({
  list: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.secret.findMany({
        where: { environmentId: input.environmentId },
        select: { id: true, name: true, createdAt: true, updatedAt: true },
        orderBy: { name: "asc" },
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        name: z.string().min(1).max(100).regex(
          /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
          "Name must start with a letter or number and contain only letters, numbers, hyphens, and underscores",
        ),
        value: z.string().min(1),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("secret.created", "Secret"))
    .mutation(async ({ input }) => {
      const existing = await prisma.secret.findUnique({
        where: { environmentId_name: { environmentId: input.environmentId, name: input.name } },
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "A secret with this name already exists in this environment" });
      }
      return prisma.secret.create({
        data: {
          name: input.name,
          encryptedValue: encrypt(input.value),
          environmentId: input.environmentId,
        },
        select: { id: true, name: true, createdAt: true, updatedAt: true },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        environmentId: z.string(),
        value: z.string().min(1),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("secret.updated", "Secret"))
    .mutation(async ({ input }) => {
      const secret = await prisma.secret.findUnique({ where: { id: input.id } });
      if (!secret || secret.environmentId !== input.environmentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Secret not found" });
      }
      return prisma.secret.update({
        where: { id: input.id },
        data: { encryptedValue: encrypt(input.value) },
        select: { id: true, name: true, updatedAt: true },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string(), environmentId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("secret.deleted", "Secret"))
    .mutation(async ({ input }) => {
      const secret = await prisma.secret.findUnique({ where: { id: input.id } });
      if (!secret || secret.environmentId !== input.environmentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Secret not found" });
      }
      await prisma.secret.delete({ where: { id: input.id } });
      return { deleted: true };
    }),

  /** Internal: resolve a secret value by name for deploy-time use */
  resolve: protectedProcedure
    .input(z.object({ environmentId: z.string(), name: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .query(async ({ input }) => {
      const secret = await prisma.secret.findUnique({
        where: { environmentId_name: { environmentId: input.environmentId, name: input.name } },
      });
      if (!secret) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Secret "${input.name}" not found` });
      }
      return { value: decrypt(secret.encryptedValue) };
    }),
});
