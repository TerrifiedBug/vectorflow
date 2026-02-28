import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireRole } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { withAudit } from "@/server/middleware/audit";

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

  teamRole: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user!.id!;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isSuperAdmin: true },
      });
      if (user?.isSuperAdmin) return { role: "ADMIN" as const, isSuperAdmin: true };

      const membership = await prisma.teamMember.findUnique({
        where: { userId_teamId: { userId, teamId: input.teamId } },
        select: { role: true },
      });
      return { role: (membership?.role ?? "VIEWER") as "VIEWER" | "EDITOR" | "ADMIN", isSuperAdmin: false };
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
            include: { user: { select: { id: true, name: true, email: true, image: true, authMethod: true, lockedAt: true } } },
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
    .use(requireRole("ADMIN"))
    .input(
      z.object({
        teamId: z.string(),
        userId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user!.id!) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot remove yourself from the team" });
      }
      const member = await prisma.teamMember.findUnique({
        where: { userId_teamId: { userId: input.userId, teamId: input.teamId } },
      });
      if (!member) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Team member not found",
        });
      }
      await prisma.teamMember.delete({ where: { id: member.id } });

      return { removed: true };
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

  lockMember: protectedProcedure
    .use(requireRole("ADMIN"))
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const adminId = ctx.session.user!.id!;
      if (input.userId === adminId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot lock your own account" });
      }
      // Verify user is a member of the team
      const member = await prisma.teamMember.findUnique({
        where: { userId_teamId: { userId: input.userId, teamId: input.teamId } },
      });
      if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Team member not found" });

      return prisma.user.update({
        where: { id: input.userId },
        data: { lockedAt: new Date(), lockedBy: adminId },
        select: { id: true, lockedAt: true },
      });
    }),

  unlockMember: protectedProcedure
    .use(requireRole("ADMIN"))
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .mutation(async ({ input }) => {
      const member = await prisma.teamMember.findUnique({
        where: { userId_teamId: { userId: input.userId, teamId: input.teamId } },
      });
      if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Team member not found" });

      return prisma.user.update({
        where: { id: input.userId },
        data: { lockedAt: null, lockedBy: null },
        select: { id: true, lockedAt: true },
      });
    }),

  resetMemberPassword: protectedProcedure
    .use(requireRole("ADMIN"))
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .mutation(async ({ input }) => {
      const member = await prisma.teamMember.findUnique({
        where: { userId_teamId: { userId: input.userId, teamId: input.teamId } },
        include: { user: { select: { authMethod: true } } },
      });
      if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Team member not found" });
      if (member.user.authMethod === "OIDC") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot reset password for SSO-only users" });
      }

      const temporaryPassword = crypto.randomBytes(12).toString("base64url").slice(0, 16);
      const passwordHash = await bcrypt.hash(temporaryPassword, 12);

      await prisma.user.update({
        where: { id: input.userId },
        data: { passwordHash },
      });

      return { temporaryPassword };
    }),
});
