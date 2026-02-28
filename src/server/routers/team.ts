import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireRole } from "@/trpc/init";
import { prisma } from "@/lib/prisma";

export const teamRouter = router({
  /** Get the current user's highest role across all teams */
  myRole: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user!.id!;
    const memberships = await prisma.teamMember.findMany({
      where: { userId },
      select: { role: true },
    });
    if (memberships.length === 0) return { role: "VIEWER" as const };
    const roleLevel: Record<string, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 };
    const best = memberships.reduce((a, b) =>
      (roleLevel[b.role] ?? 0) > (roleLevel[a.role] ?? 0) ? b : a
    );
    return { role: best.role };
  }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user!.id!;
    return prisma.team.findMany({
      where: {
        members: { some: { userId } },
      },
      include: {
        _count: { select: { members: true, environments: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const team = await prisma.team.findUnique({
        where: { id: input.id },
        include: {
          members: {
            include: { user: { select: { id: true, name: true, email: true, image: true, authMethod: true } } },
          },
          _count: { select: { environments: true } },
        },
      });
      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
      }
      return team;
    }),

  create: protectedProcedure
    .use(requireRole("ADMIN"))
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user!.id!;
      return prisma.team.create({
        data: {
          name: input.name,
          members: {
            create: { userId, role: "ADMIN" },
          },
        },
        include: { members: true },
      });
    }),

  rename: protectedProcedure
    .use(requireRole("ADMIN"))
    .input(z.object({ teamId: z.string(), name: z.string().min(1).max(100) }))
    .mutation(async ({ input }) => {
      const team = await prisma.team.findUnique({ where: { id: input.teamId } });
      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
      }
      return prisma.team.update({
        where: { id: input.teamId },
        data: { name: input.name },
      });
    }),

  addMember: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        email: z.string().email(),
        role: z.enum(["VIEWER", "EDITOR", "ADMIN"]),
      })
    )
    .mutation(async ({ input }) => {
      // Look up user by email
      const user = await prisma.user.findUnique({
        where: { email: input.email },
      });
      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No user found with email "${input.email}". The user must sign up first.`,
        });
      }

      const existing = await prisma.teamMember.findUnique({
        where: { userId_teamId: { userId: user.id, teamId: input.teamId } },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User is already a member of this team",
        });
      }
      return prisma.teamMember.create({
        data: {
          teamId: input.teamId,
          userId: user.id,
          role: input.role,
        },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
    }),

  removeMember: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        userId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const member = await prisma.teamMember.findUnique({
        where: { userId_teamId: { userId: input.userId, teamId: input.teamId } },
      });
      if (!member) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Team member not found",
        });
      }
      return prisma.teamMember.delete({
        where: { id: member.id },
      });
    }),

  updateMemberRole: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        userId: z.string(),
        role: z.enum(["VIEWER", "EDITOR", "ADMIN"]),
      })
    )
    .mutation(async ({ input }) => {
      const member = await prisma.teamMember.findUnique({
        where: { userId_teamId: { userId: input.userId, teamId: input.teamId } },
      });
      if (!member) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Team member not found",
        });
      }
      return prisma.teamMember.update({
        where: { id: member.id },
        data: { role: input.role },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
    }),
});
