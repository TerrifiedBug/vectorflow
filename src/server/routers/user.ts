import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
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
    const user = await prisma.user.findUnique({
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
    });
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
      isSuperAdmin: user?.isSuperAdmin ?? false,
      twoFactorRequired: user?.authMethod !== "OIDC" && (user?.isSuperAdmin || teamRequires2fa),
    };
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
        data: { passwordHash, mustChangePassword: false },
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

  /**
   * Begin TOTP setup. Generates a secret and returns the otpauth URI
   * for QR code display, plus backup codes.
   * The secret is stored encrypted but TOTP is NOT yet enabled —
   * the user must verify a code via verifyAndEnableTotp first.
   */
  setupTotp: protectedProcedure
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
});
