import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { withAudit } from "@/server/middleware/audit";

export const userRouter = router({
  /** Returns current user's auth method for client-side feature gating */
  me: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user!.id!;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { authMethod: true },
    });
    return { authMethod: user?.authMethod ?? "LOCAL" };
  }),

  changePassword: protectedProcedure
    .use(withAudit("user.password_changed", "User"))
    .input(
      z.object({
        currentPassword: z.string(),
        newPassword: z.string().min(8),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user!.id!;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { passwordHash: true, authMethod: true },
      });

      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      if (user.authMethod === "OIDC") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Password change not available for SSO users",
        });
      }

      if (!user.passwordHash) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No password set for this account",
        });
      }

      const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Current password is incorrect",
        });
      }

      const passwordHash = await bcrypt.hash(input.newPassword, 12);

      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      });

      return { success: true };
    }),

  updateProfile: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user!.id!;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { authMethod: true },
      });
      if (user?.authMethod === "OIDC") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Profile editing is not available for SSO users",
        });
      }
      return prisma.user.update({
        where: { id: userId },
        data: { name: input.name },
        select: { id: true, name: true, email: true },
      });
    }),
});
