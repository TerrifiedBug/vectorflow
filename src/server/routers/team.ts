import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess, requireSuperAdmin } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { withAudit } from "@/server/middleware/audit";
import { encrypt } from "@/server/services/crypto";
import { testAiConnection } from "@/server/services/ai";

/**
 * Block manual team assignment/role changes for OIDC users when their
 * memberships are managed by an identity provider (SCIM or OIDC group sync).
 * Flat SSO deployments (OIDC without group sync) allow manual assignment.
 */
export async function assertManualAssignmentAllowed(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { authMethod: true },
  });
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  }
  if (user.authMethod !== "OIDC") return;

  const settings = await prisma.systemSettings.findUnique({
    where: { id: "singleton" },
    select: { scimEnabled: true, oidcGroupSyncEnabled: true },
  });
  if (settings?.scimEnabled || settings?.oidcGroupSyncEnabled) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This user's team membership is managed by your identity provider. " +
        "Update their group assignments in your IdP instead.",
    });
  }
}

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
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });

    const teams = await prisma.team.findMany({
      where: {
        name: { not: "__system__" },
        ...(user?.isSuperAdmin ? {} : { members: { some: { userId } } }),
      },
      include: {
        _count: { select: { members: true, environments: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    // Strip encrypted API key — never send to client
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return teams.map(({ aiApiKey: _aiApiKey, ...safeTeam }) => safeTeam);
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const team = await prisma.team.findUnique({
        where: { id: input.id },
        include: {
          members: {
            include: { user: { select: { id: true, name: true, email: true, image: true, authMethod: true, totpEnabled: true, lockedAt: true, scimExternalId: true } } },
          },
          _count: { select: { environments: true } },
        },
      });
      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
      }
      // Strip encrypted API key — never send to client
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { aiApiKey: _aiApiKey, ...safeTeam } = team;
      return safeTeam;
    }),

  create: protectedProcedure
    .use(requireSuperAdmin())
    .use(withAudit("team.created", "Team"))
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

  delete: protectedProcedure
    .use(requireSuperAdmin())
    .use(withAudit("team.deleted", "Team"))
    .input(z.object({ teamId: z.string() }))
    .mutation(async ({ input }) => {
      const team = await prisma.team.findUnique({
        where: { id: input.teamId },
        include: {
          environments: { select: { name: true } },
        },
      });
      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
      }
      if (team.environments.length > 0) {
        const names = team.environments.map((e) => e.name).join(", ");
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot delete team with environments. Remove these first: ${names}`,
        });
      }
      const teamCount = await prisma.team.count();
      if (teamCount <= 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot delete the last remaining team",
        });
      }
      await prisma.$transaction([
        prisma.auditLog.deleteMany({ where: { teamId: input.teamId } }),
        prisma.template.deleteMany({ where: { teamId: input.teamId } }),
        prisma.teamMember.deleteMany({ where: { teamId: input.teamId } }),
        prisma.team.delete({ where: { id: input.teamId } }),
      ]);
      return { deleted: true };
    }),

  rename: protectedProcedure
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("team.renamed", "Team"))
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
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("team.member_added", "Team"))
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

      await assertManualAssignmentAllowed(user.id);

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
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("team.member_removed", "Team"))
    .input(
      z.object({
        teamId: z.string(),
        userId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session!.user!.id!) {
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
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("team.member_role_updated", "Team"))
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
      await assertManualAssignmentAllowed(input.userId);
      return prisma.teamMember.update({
        where: { id: member.id },
        data: { role: input.role },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
    }),

  lockMember: protectedProcedure
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("team.member_locked", "User"))
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const adminId = ctx.session!.user!.id!;
      if (input.userId === adminId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot lock your own account" });
      }
      // Verify user is a member of the team
      const member = await prisma.teamMember.findUnique({
        where: { userId_teamId: { userId: input.userId, teamId: input.teamId } },
      });
      if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Team member not found" });

      // Prevent team admins from locking super admin accounts
      const targetUser = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { isSuperAdmin: true },
      });
      if (targetUser?.isSuperAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot lock a super admin account" });
      }

      return prisma.user.update({
        where: { id: input.userId },
        data: { lockedAt: new Date(), lockedBy: adminId },
        select: { id: true, lockedAt: true },
      });
    }),

  unlockMember: protectedProcedure
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("team.member_unlocked", "User"))
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .mutation(async ({ input }) => {
      const member = await prisma.teamMember.findUnique({
        where: { userId_teamId: { userId: input.userId, teamId: input.teamId } },
      });
      if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Team member not found" });

      // Prevent team admins from unlocking super admin accounts
      const targetUser = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { isSuperAdmin: true },
      });
      if (targetUser?.isSuperAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot modify a super admin account" });
      }

      return prisma.user.update({
        where: { id: input.userId },
        data: { lockedAt: null, lockedBy: null },
        select: { id: true, lockedAt: true },
      });
    }),

  resetMemberPassword: protectedProcedure
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("team.member_password_reset", "User"))
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .mutation(async ({ input }) => {
      const member = await prisma.teamMember.findUnique({
        where: { userId_teamId: { userId: input.userId, teamId: input.teamId } },
        include: { user: { select: { authMethod: true, isSuperAdmin: true } } },
      });
      if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Team member not found" });

      // Prevent team admins from resetting super admin passwords
      if (member.user.isSuperAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot reset a super admin password" });
      }
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

  updateRequireTwoFactor: protectedProcedure
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("team.require_2fa_updated", "Team"))
    .input(z.object({ teamId: z.string(), requireTwoFactor: z.boolean() }))
    .mutation(async ({ input }) => {
      return prisma.team.update({
        where: { id: input.teamId },
        data: { requireTwoFactor: input.requireTwoFactor },
        select: { id: true, requireTwoFactor: true },
      });
    }),

  updateAvailableTags: protectedProcedure
    .input(z.object({
      teamId: z.string(),
      tags: z.array(z.string().min(1).max(30)).refine(
        (arr) => new Set(arr).size === arr.length,
        { message: "Duplicate tags are not allowed" },
      ),
    }))
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("team.updated", "Team"))
    .mutation(async ({ input }) => {
      return prisma.team.update({
        where: { id: input.teamId },
        data: { availableTags: input.tags },
      });
    }),

  updateDefaultEnvironment: protectedProcedure
    .input(z.object({
      teamId: z.string(),
      defaultEnvironmentId: z.string().nullable(),
    }))
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("team.updated", "Team"))
    .mutation(async ({ input }) => {
      if (input.defaultEnvironmentId) {
        const env = await prisma.environment.findUnique({
          where: { id: input.defaultEnvironmentId },
        });
        if (!env || env.teamId !== input.teamId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Environment not found or does not belong to this team",
          });
        }
      }
      return prisma.team.update({
        where: { id: input.teamId },
        data: { defaultEnvironmentId: input.defaultEnvironmentId },
        select: { id: true, defaultEnvironmentId: true },
      });
    }),

  getAvailableTags: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const team = await prisma.team.findUnique({
        where: { id: input.teamId },
        select: { availableTags: true },
      });
      return (team?.availableTags as string[]) ?? [];
    }),

  linkMemberToOidc: protectedProcedure
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("team.member_linked_oidc", "User"))
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const adminId = ctx.session!.user!.id!;
      if (input.userId === adminId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot link your own account — sign in via SSO directly" });
      }

      const member = await prisma.teamMember.findUnique({
        where: { userId_teamId: { userId: input.userId, teamId: input.teamId } },
      });
      if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Team member not found" });

      const targetUser = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { authMethod: true, isSuperAdmin: true },
      });
      if (!targetUser) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      if (targetUser.isSuperAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot modify a super admin account" });
      }
      if (targetUser.authMethod !== "LOCAL") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "User is already using SSO" });
      }

      return prisma.user.update({
        where: { id: input.userId },
        data: {
          authMethod: "OIDC",
          passwordHash: null,
          totpEnabled: false,
          totpSecret: null,
          totpBackupCodes: null,
        },
        select: { id: true, authMethod: true },
      });
    }),

  getAiConfig: protectedProcedure
    .use(withTeamAccess("ADMIN"))
    .input(z.object({ teamId: z.string() }))
    .query(async ({ input }) => {
      const team = await prisma.team.findUniqueOrThrow({
        where: { id: input.teamId },
        select: {
          aiEnabled: true,
          aiProvider: true,
          aiBaseUrl: true,
          aiModel: true,
          aiApiKey: true,
        },
      });
      return {
        aiEnabled: team.aiEnabled,
        aiProvider: team.aiProvider,
        aiBaseUrl: team.aiBaseUrl,
        aiModel: team.aiModel,
        hasApiKey: !!team.aiApiKey,
      };
    }),

  updateAiConfig: protectedProcedure
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("team.ai_config_updated", "Team"))
    .input(
      z.object({
        teamId: z.string(),
        aiEnabled: z.boolean().optional(),
        aiProvider: z.enum(["openai", "custom"]).nullable().optional(),
        aiBaseUrl: z.string().nullable().optional(),
        aiModel: z.string().nullable().optional(),
        aiApiKey: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { teamId, aiApiKey, ...rest } = input;
      const data: Record<string, unknown> = { ...rest };

      // Encrypt API key if provided
      if (aiApiKey !== undefined) {
        data.aiApiKey = aiApiKey ? `enc:${encrypt(aiApiKey)}` : null;
      }

      return prisma.team.update({
        where: { id: teamId },
        data,
        select: { id: true, aiEnabled: true, aiProvider: true, aiBaseUrl: true, aiModel: true },
      });
    }),

  testAiConnection: protectedProcedure
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("team.ai_connection_tested", "Team"))
    .input(z.object({ teamId: z.string() }))
    .mutation(async ({ input }) => {
      return testAiConnection(input.teamId);
    }),
});
