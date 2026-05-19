import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, denyInDemo } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { isOrgWideAdmin } from "@/lib/org-admin";
import { withAudit } from "@/server/middleware/audit";
import { encrypt, decrypt } from "@/server/services/crypto";
import {
  generateTotpSecret,
  verifyTotpCode,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
} from "@/server/services/totp";

export const userRouter = router({
  /** Returns current user info for client-side feature gating */
  me: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user!.id!;
    const [user, isOrgAdmin] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          email: true,
          authMethod: true,
          mustChangePassword: true,
          totpEnabled: true,
          isSuperAdmin: true,
          memberships: {
            select: { team: { select: { requireTwoFactor: true } } },
          },
        },
      }),
      isOrgWideAdmin(userId, ctx.organizationId),
    ]);
    // Check if any team requires 2FA
    const teamRequires2fa = user?.memberships.some(
      (m) => m.team.requireTwoFactor
    ) ?? false;
    return {
      name: user?.name ?? null,
      email: user?.email ?? null,
      authMethod: user?.authMethod ?? "LOCAL",
      mustChangePassword: user?.mustChangePassword ?? false,
      totpEnabled: user?.totpEnabled ?? false,
      /**
       * @deprecated Read `isOrgAdmin` instead. This field is retained
       *   for back-compat while UI callsites migrate.
       */
      isSuperAdmin: user?.isSuperAdmin ?? false,
      /** True when the caller is OWNER or ADMIN of their resolved org. */
      isOrgAdmin,
      twoFactorRequired: user?.authMethod !== "OIDC" && teamRequires2fa,
    };
  }),

  changePassword: protectedProcedure
    .use(denyInDemo())
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
        data: { passwordHash, mustChangePassword: false },
      });

      return { success: true };
    }),

  updateProfile: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
    }))
    .use(denyInDemo())
    .use(withAudit("user.profile_updated", "User"))
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

  /**
   * Begin TOTP setup. Generates a secret and returns the otpauth URI
   * for QR code display, plus backup codes.
   * The secret is stored encrypted but TOTP is NOT yet enabled —
   * the user must verify a code via verifyAndEnableTotp first.
   */
  setupTotp: protectedProcedure
    .use(denyInDemo())
    .use(withAudit("user.totp_setup_started", "User"))
    .mutation(async ({ ctx }) => {
      const userId = ctx.session.user!.id!;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, totpEnabled: true, authMethod: true },
      });

      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      if (user.authMethod === "OIDC") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "2FA is managed by your SSO provider",
        });
      }
      if (user.totpEnabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "2FA is already enabled. Disable it first to reconfigure.",
        });
      }

      const { secret, uri } = generateTotpSecret(user.email);
      const backupCodes = generateBackupCodes();
      const hashedCodes = backupCodes.map(hashBackupCode);

      // Store pending secret (not yet enabled)
      await prisma.user.update({
        where: { id: userId },
        data: {
          totpSecret: encrypt(secret),
          totpBackupCodes: encrypt(JSON.stringify(hashedCodes)),
        },
      });

      return { uri, secret, backupCodes };
    }),

  /**
   * Verify a TOTP code against the pending secret and enable 2FA.
   */
  verifyAndEnableTotp: protectedProcedure
    .use(denyInDemo())
    .use(withAudit("user.totp_enabled", "User"))
    .input(z.object({ code: z.string().length(6) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user!.id!;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { totpSecret: true, totpEnabled: true },
      });

      if (!user?.totpSecret) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No TOTP setup in progress. Call setupTotp first.",
        });
      }
      if (user.totpEnabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "2FA is already enabled.",
        });
      }

      const secret = decrypt(user.totpSecret);
      if (!verifyTotpCode(secret, input.code)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid verification code. Please try again.",
        });
      }

      await prisma.user.update({
        where: { id: userId },
        data: { totpEnabled: true },
      });

      return { enabled: true };
    }),

  /**
   * Disable 2FA. Requires a valid TOTP code to confirm.
   */
  disableTotp: protectedProcedure
    .use(denyInDemo())
    .use(withAudit("user.totp_disabled", "User"))
    .input(z.object({ code: z.string().min(6) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user!.id!;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { totpSecret: true, totpEnabled: true, totpBackupCodes: true },
      });

      if (!user?.totpEnabled || !user.totpSecret) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "2FA is not enabled.",
        });
      }

      const secret = decrypt(user.totpSecret);
      const codeValid = verifyTotpCode(secret, input.code);

      if (!codeValid) {
        // Try backup code
        let backupValid = false;
        if (user.totpBackupCodes) {
          const hashedCodes: string[] = JSON.parse(decrypt(user.totpBackupCodes));
          const result = verifyBackupCode(input.code, hashedCodes);
          backupValid = result.valid;
        }
        if (!backupValid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid code. Enter your TOTP code or a backup code.",
          });
        }
      }

      await prisma.user.update({
        where: { id: userId },
        data: {
          totpEnabled: false,
          totpSecret: null,
          totpBackupCodes: null,
        },
      });

      return { disabled: true };
    }),

  /**
   * Right-to-erasure (GDPR Art. 17) — caller pseudonymises their own
   * account.
   *
   * Strategy is pseudonymisation, not hard-delete. The User row stays
   * (because many tenant tables hold non-nullable FKs back to it that
   * would block delete or, worse, cascade-wipe tenant work the
   * organisation owns); the row's PII columns are blanked, the email
   * is rewritten to an unguessable `erased+<random>@anon.invalid`
   * placeholder that satisfies the UNIQUE constraint without leaking
   * the prior address, and every auth-bearing relation is dropped:
   *
   *   - WebAuthn passkeys, OAuth Accounts, sessions, scim-group bindings,
   *     team memberships, dashboard views, user preferences — all
   *     cascade-deleted off the relations or explicitly removed here.
   *   - OrgMember rows are deleted so the user no longer belongs to
   *     any organisation.
   *   - AuditLog.userId is anonymised to NULL (already nullable per
   *     migration `20260303120000_audit_log_nullable_userid`).
   *   - PlatformOperator with a matching email is soft-deleted.
   *
   * Pre-flight refusal: if the caller is the sole OWNER of an org with
   * other members, the org would be orphaned. We refuse and direct
   * them to `org.transferOwnership` first.
   *
   * Confirmation:
   *   - LOCAL auth must pass the current password.
   *   - OIDC auth: re-auth is enforced by NextAuth on the front-end
   *     before the call; this procedure trusts the session.
   */
  eraseSelf: protectedProcedure
    .use(denyInDemo())
    .input(
      z.object({
        currentPassword: z.string().optional(),
        // Required typed acknowledgement so a stray click cannot
        // permanently erase an account.
        confirmation: z.literal("erase my account"),
      }),
    )
    .use(withAudit("user.erased", "User"))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user!.id!;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          passwordHash: true,
          authMethod: true,
        },
      });
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
      }

      // Confirm credentials for LOCAL accounts. OIDC accounts re-auth
      // upstream; we trust the just-issued session.
      if (user.authMethod === "LOCAL") {
        if (!input.currentPassword || !user.passwordHash) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Current password is required to confirm account erasure.",
          });
        }
        const ok = await bcrypt.compare(input.currentPassword, user.passwordHash);
        if (!ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Current password is incorrect.",
          });
        }
      }

      // Unguessable placeholder address. Length keeps the row index-able
      // and well under the 320-char RFC limit even with the cuid suffix.
      const anonEmail = `erased+${user.id}@anon.invalid`;

      await prisma.$transaction(async (tx) => {
        // Sole-OWNER orphan check — run INSIDE the transaction so a
        // concurrent OrgMember mutation between the check and the
        // OrgMember.deleteMany below cannot orphan an organisation.
        // Codex P2 review pointed out the prior outside-the-txn check
        // had a TOCTOU window: another OWNER could be demoted (or the
        // last non-OWNER member added) between the check and the delete.
        const ownedOrgMemberships = await tx.orgMember.findMany({
          where: { userId, role: "OWNER" },
          select: { organizationId: true },
        });
        for (const { organizationId } of ownedOrgMemberships) {
          const otherMembers = await tx.orgMember.count({
            where: { organizationId, NOT: { userId } },
          });
          const otherOwners = await tx.orgMember.count({
            where: { organizationId, role: "OWNER", NOT: { userId } },
          });
          if (otherMembers > 0 && otherOwners === 0) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "You are the sole OWNER of an organisation with other members. " +
                "Transfer ownership before erasing your account.",
            });
          }
        }

        // Drop every auth-bearing or org-bearing relation. Each delete
        // is scoped to the caller; we never touch other users.
        await tx.orgMember.deleteMany({ where: { userId } });
        await tx.teamMember.deleteMany({ where: { userId } });
        await tx.scimGroupMember.deleteMany({ where: { userId } });
        await tx.webAuthnCredential.deleteMany({ where: { userId } });
        await tx.account.deleteMany({ where: { userId } });
        await tx.userPreference.deleteMany({ where: { userId } });
        await tx.dashboardView.deleteMany({ where: { userId } });

        // Anonymise audit trail — userId is nullable on AuditLog.
        await tx.auditLog.updateMany({
          where: { userId },
          data: { userId: null },
        });

        // Pseudonymise the User row itself. Keep the id, rewrite every
        // PII column. lockedAt prevents sign-in even if the row somehow
        // re-acquires credentials.
        await tx.user.update({
          where: { id: userId },
          data: {
            email: anonEmail,
            name: null,
            image: null,
            passwordHash: null,
            authMethod: "LOCAL",
            mustChangePassword: false,
            totpEnabled: false,
            totpSecret: null,
            totpBackupCodes: null,
            scimExternalId: null,
            isSuperAdmin: false,
            lockedAt: new Date(),
            lockedBy: "erasure",
          },
        });

        // Soft-delete a matching PlatformOperator row if one was minted
        // during single-tenant bootstrap (linkage is email-only).
        const operator = await tx.platformOperator.findUnique({
          where: { email: user.email },
          select: { id: true, deletedAt: true },
        });
        if (operator && !operator.deletedAt) {
          await tx.platformOperator.update({
            where: { id: operator.id },
            data: { deletedAt: new Date() },
          });
        }
      });

      return { id: userId, erased: true };
    }),
});