import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireSuperAdmin } from "@/trpc/init";
import { prisma } from "@/lib/prisma";

export const adminRouter = router({
  /** List all platform users with their team memberships */
  listUsers: protectedProcedure
    .use(requireSuperAdmin())
    .query(async () => {
      return prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          authMethod: true,
          isSuperAdmin: true,
          lockedAt: true,
          createdAt: true,
          memberships: {
            select: {
              role: true,
              team: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });
    }),

  /** Assign a user to a team with a specific role */
  assignToTeam: protectedProcedure
    .use(requireSuperAdmin())
    .input(z.object({
      userId: z.string(),
      teamId: z.string(),
      role: z.enum(["VIEWER", "EDITOR", "ADMIN"]),
    }))
    .mutation(async ({ input }) => {
      const existing = await prisma.teamMember.findUnique({
        where: { userId_teamId: { userId: input.userId, teamId: input.teamId } },
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "User is already a member of this team" });
      }
      return prisma.teamMember.create({
        data: { userId: input.userId, teamId: input.teamId, role: input.role },
      });
    }),

  /** Delete a user and all their data */
  deleteUser: protectedProcedure
    .use(requireSuperAdmin())
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user!.id!) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot delete yourself" });
      }

      const user = await prisma.user.findUnique({ where: { id: input.userId } });
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      // Clean up references before deleting
      await prisma.auditLog.deleteMany({ where: { userId: input.userId } });
      await prisma.pipeline.updateMany({
        where: { updatedById: input.userId },
        data: { updatedById: null },
      });
      await prisma.teamMember.deleteMany({ where: { userId: input.userId } });
      await prisma.account.deleteMany({ where: { userId: input.userId } });
      await prisma.user.delete({ where: { id: input.userId } });

      return { deleted: true };
    }),

  /** Toggle super admin status */
  toggleSuperAdmin: protectedProcedure
    .use(requireSuperAdmin())
    .input(z.object({ userId: z.string(), isSuperAdmin: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user!.id! && !input.isSuperAdmin) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot remove your own super admin status" });
      }
      return prisma.user.update({
        where: { id: input.userId },
        data: { isSuperAdmin: input.isSuperAdmin },
        select: { id: true, isSuperAdmin: true },
      });
    }),

  /** List all teams (for assignment dialog) */
  listTeams: protectedProcedure
    .use(requireSuperAdmin())
    .query(async () => {
      return prisma.team.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
    }),
});
