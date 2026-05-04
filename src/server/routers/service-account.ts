import crypto from "crypto";
import { z } from "zod";
import { router, protectedProcedure, withTeamAccess, denyInDemo } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import { TRPCError } from "@trpc/server";
import {
  SERVICE_ACCOUNT_PERMISSIONS,
  type ServiceAccountPermission,
} from "@/lib/service-account-permissions";

export const PERMISSIONS = SERVICE_ACCOUNT_PERMISSIONS;
export type Permission = ServiceAccountPermission;

export const serviceAccountRouter = router({
  list: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("ADMIN"))
    .query(async ({ input }) => {
      return prisma.serviceAccount.findMany({
        where: { environmentId: input.environmentId },
        select: {
          id: true,
          name: true,
          description: true,
          keyPrefix: true,
          environmentId: true,
          permissions: true,
          lastUsedAt: true,
          expiresAt: true,
          enabled: true,
          createdAt: true,
          createdBy: {
            select: { name: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        permissions: z.array(z.enum(PERMISSIONS)).min(1),
        expiresInDays: z.number().int().min(1).optional(),
      }),
    )
    .use(denyInDemo())
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("serviceAccount.created", "ServiceAccount"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const existing = await prisma.serviceAccount.findFirst({
        where: { environmentId: input.environmentId, name: input.name },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "A service account with this name already exists in this environment",
        });
      }

      const rawKey = `vf_live_${crypto.randomBytes(24).toString("hex")}`;
      const hashedKey = crypto
        .createHash("sha256")
        .update(rawKey)
        .digest("hex");
      const keyPrefix = rawKey.substring(0, 16);

      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      const sa = await prisma.serviceAccount.create({
        data: {
          name: input.name,
          description: input.description,
          hashedKey,
          keyPrefix,
          environmentId: input.environmentId,
          permissions: input.permissions,
          createdById: userId,
          expiresAt,
        },
        select: {
          id: true,
          name: true,
          keyPrefix: true,
          permissions: true,
          expiresAt: true,
          createdAt: true,
        },
      });

      return {
        ...sa,
        rawKey,
      };
    }),

  revoke: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(denyInDemo())
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("serviceAccount.revoked", "ServiceAccount"))
    .mutation(async ({ input }) => {
      const sa = await prisma.serviceAccount.findUnique({
        where: { id: input.id },
      });
      if (!sa) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Service account not found",
        });
      }

      return prisma.serviceAccount.update({
        where: { id: input.id },
        data: { enabled: false },
        select: { id: true, name: true, enabled: true },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(denyInDemo())
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("serviceAccount.deleted", "ServiceAccount"))
    .mutation(async ({ input }) => {
      const sa = await prisma.serviceAccount.findUnique({
        where: { id: input.id },
      });
      if (!sa) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Service account not found",
        });
      }

      await prisma.serviceAccount.delete({ where: { id: input.id } });
      return { deleted: true };
    }),
});
