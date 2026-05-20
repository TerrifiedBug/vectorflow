import { z } from "zod";
import crypto from "crypto";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { router, protectedProcedure, requirePlatformOperator, denyInDemo } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import { writeAuditLog } from "@/server/services/audit";
import { assertManualAssignmentAllowed } from "@/server/routers/team";
import { isStrictMultiTenantMode } from "@/lib/security-headers";

export const adminRouter = router({
  /**
   * List all platform users with their team memberships.
   *
   * `isPlatformOperator` is derived from `PlatformOperator.email` matching
   * `User.email`. The legacy `User.isSuperAdmin` column was dropped in
   * slice 7c; operator status now lives exclusively on the
   * `PlatformOperator` table.
   */
  listUsers: protectedProcedure
    .use(requirePlatformOperator())
    .query(async () => {
      const [users, operatorEmails] = await Promise.all([
        prisma.user.findMany({
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            authMethod: true,
            totpEnabled: true,
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
        }),
        prisma.platformOperator.findMany({
          where: { deletedAt: null },
          select: { email: true },
        }),
      ]);
      const operatorEmailSet = new Set(operatorEmails.map((o) => o.email));
      return users.map((u) => ({
        ...u,
        isPlatformOperator: operatorEmailSet.has(u.email),
      }));
    }),

  /** Assign a user to a team with a specific role */
  assignToTeam: protectedProcedure
    .use(denyInDemo())
    .use(requirePlatformOperator())
    .use(withAudit("admin.user_assigned_to_team", "User"))
    .input(z.object({
      userId: z.string(),
      teamId: z.string(),
      role: z.enum(["VIEWER", "EDITOR", "ADMIN"]),
    }))
    .mutation(async ({ input }) => {
      await assertManualAssignmentAllowed(input.userId);

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
    .use(denyInDemo())
    .use(requirePlatformOperator())
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user!.id!) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot delete yourself" });
      }

      const user = await prisma.user.findUnique({ where: { id: input.userId } });
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      // Write audit log BEFORE deletion with userId: null to avoid FK violation.
      // The user record won't exist after the transaction, so we capture
      // their identity in userEmail/userName/metadata instead.
      await writeAuditLog({
        userId: null,
        action: "admin.user_deleted",
        entityType: "User",
        entityId: input.userId,
        metadata: {
          deletedUserEmail: user.email,
          deletedUserName: user.name,
          deletedById: ctx.session.user!.id!,
        },
        ipAddress: (ctx as Record<string, unknown>).ipAddress as string | null ?? null,
        userEmail: ctx.session.user!.email ?? null,
        userName: ctx.session.user!.name ?? null,
      });

      // Clean up references and delete user atomically
      await prisma.$transaction([
        prisma.auditLog.deleteMany({ where: { userId: input.userId } }),
        prisma.pipeline.updateMany({
          where: { updatedById: input.userId },
          data: { updatedById: null },
        }),
        prisma.teamMember.deleteMany({ where: { userId: input.userId } }),
        prisma.account.deleteMany({ where: { userId: input.userId } }),
        prisma.user.delete({ where: { id: input.userId } }),
      ]);

      return { deleted: true };
    }),

  /**
   * Toggle Platform Operator status for a tenant User (by id).
   *
   * The legacy `admin.toggleSuperAdmin` mutation (slice 7a) mutated
   * `User.isSuperAdmin` and mirrored the value into PlatformOperator. The
   * column was dropped in slice 7c; this mutation now operates directly
   * on the `PlatformOperator` table — no `User` write, no mirror to keep
   * in sync. Email is the natural join key (PlatformOperator has a
   * `@unique` email column).
   *
   * Strict multi-tenant mode is a no-op: operators are provisioned via
   * a separate surface there, never from the tenant admin UI.
   */
  togglePlatformOperator: protectedProcedure
    .use(denyInDemo())
    .use(requirePlatformOperator())
    .use(withAudit("admin.platform_operator_toggled", "User"))
    .input(z.object({ userId: z.string(), isOperator: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user!.id! && !input.isOperator) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove your own platform operator status",
        });
      }

      if (isStrictMultiTenantMode()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Platform operators are provisioned via a separate surface in strict multi-tenant mode.",
        });
      }

      // Load the target user to derive the operator's email/name. Surface
      // a clear NOT_FOUND rather than letting the upsert fail on a
      // synthetic null email.
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, email: true, name: true },
      });
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      if (input.isOperator) {
        await prisma.platformOperator.upsert({
          where: { email: user.email },
          create: {
            email: user.email,
            name: user.name ?? user.email,
            role: "INCIDENT",
          },
          update: { deletedAt: null },
        });
      } else {
        await prisma.platformOperator.updateMany({
          where: { email: user.email, deletedAt: null },
          data: { deletedAt: new Date() },
        });
      }

      return { id: user.id, isPlatformOperator: input.isOperator };
    }),

  /** List all teams (for assignment dialog) */
  listTeams: protectedProcedure
    .use(requirePlatformOperator())
    .query(async () => {
      return prisma.team.findMany({
        where: { name: { not: "__system__" } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
    }),

  /** Create a local user account */
  createUser: protectedProcedure
    .use(denyInDemo())
    .use(requirePlatformOperator())
    .use(withAudit("admin.user_created", "User"))
    .input(z.object({
      email: z.string().email(),
      name: z.string().min(1).max(100),
      teamId: z.string().optional(),
      role: z.enum(["VIEWER", "EDITOR", "ADMIN"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const existing = await prisma.user.findUnique({ where: { email: input.email } });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "A user with this email already exists" });
      }

      const generatedPassword = crypto.randomBytes(12).toString("base64url").slice(0, 16);
      const passwordHash = await bcrypt.hash(generatedPassword, 12);

      const user = await prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          authMethod: "LOCAL",
          mustChangePassword: true,
        },
      });

      if (input.teamId && input.role) {
        await prisma.teamMember.create({
          data: { userId: user.id, teamId: input.teamId, role: input.role },
        });
      }

      return { id: user.id, email: user.email, name: user.name, generatedPassword };
    }),

  /** Remove a user from a specific team */
  removeFromTeam: protectedProcedure
    .use(denyInDemo())
    .use(requirePlatformOperator())
    .use(withAudit("admin.user_removed_from_team", "User"))
    .input(z.object({ userId: z.string(), teamId: z.string() }))
    .mutation(async ({ input }) => {
      const member = await prisma.teamMember.findUnique({
        where: { userId_teamId: { userId: input.userId, teamId: input.teamId } },
      });
      if (!member) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team membership not found" });
      }
      await prisma.teamMember.delete({ where: { id: member.id } });
      return { removed: true };
    }),

  /** Lock a user account */
  lockUser: protectedProcedure
    .use(denyInDemo())
    .use(requirePlatformOperator())
    .use(withAudit("admin.user_locked", "User"))
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user!.id!) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot lock your own account" });
      }
      return prisma.user.update({
        where: { id: input.userId },
        data: { lockedAt: new Date(), lockedBy: ctx.session.user!.id! },
        select: { id: true, lockedAt: true },
      });
    }),

  /** Unlock a user account */
  unlockUser: protectedProcedure
    .use(denyInDemo())
    .use(requirePlatformOperator())
    .use(withAudit("admin.user_unlocked", "User"))
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input }) => {
      return prisma.user.update({
        where: { id: input.userId },
        data: { lockedAt: null, lockedBy: null },
        select: { id: true, lockedAt: true },
      });
    }),

  /** Reset a user's password (generates temporary password) */
  resetPassword: protectedProcedure
    .use(denyInDemo())
    .use(requirePlatformOperator())
    .use(withAudit("admin.password_reset", "User"))
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input }) => {
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { authMethod: true },
      });
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      if (user.authMethod === "OIDC") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot reset password for SSO users" });
      }
      const temporaryPassword = crypto.randomBytes(12).toString("base64url").slice(0, 16);
      const passwordHash = await bcrypt.hash(temporaryPassword, 12);
      await prisma.user.update({
        where: { id: input.userId },
        data: { passwordHash, mustChangePassword: true },
      });
      return { temporaryPassword };
    }),
});
