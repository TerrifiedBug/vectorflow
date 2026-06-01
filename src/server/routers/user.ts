import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, denyInDemo } from "@/trpc/init";
import { prisma, adminPrisma } from "@/lib/prisma";
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

/**
 * True when a freshly-matched TOTP step is a replay of an already-consumed
 * step (`<= lastTotpStep`). Used to keep settings-UI TOTP verification
 * single-use, consistent with the login path (VF-16).
 */
function isTotpReplay(matchedStep: number | null, lastTotpStep: number | null): boolean {
  return (
    matchedStep !== null &&
    lastTotpStep !== null &&
    matchedStep <= lastTotpStep
  );
}

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
          memberships: {
            select: { team: { select: { requireTwoFactor: true } } },
          },
        },
      }),
      isOrgWideAdmin(userId, ctx.organizationId),
    ]);
    // Check platform-operator status by email after user is resolved.
    // Needed so client components can gate platform-operator-only endpoints
    // (settings readiness, system environment selector) without triggering
    // 403s for org admins who are not operators.
    const platformOperatorRow = user?.email
      ? await prisma.platformOperator.findUnique({
          where: { email: user.email },
          select: { deletedAt: true },
        })
      : null;
    const isPlatformOperator = !!platformOperatorRow && !platformOperatorRow.deletedAt;
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
      /** True when the caller is OWNER or ADMIN of their resolved org. */
      isOrgAdmin,
      /** True when the caller has an active PlatformOperator row (no deletedAt). */
      isPlatformOperator,
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
        select: { totpSecret: true, totpEnabled: true, lastTotpStep: true },
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
      const matchedStep = verifyTotpCode(secret, input.code);
      if (matchedStep === null || isTotpReplay(matchedStep, user.lastTotpStep)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid verification code. Please try again.",
        });
      }

      // Persist the consumed step alongside enabling 2FA so the same code
      // cannot be replayed at the login screen immediately after enrolment.
      await prisma.user.update({
        where: { id: userId },
        data: { totpEnabled: true, lastTotpStep: matchedStep },
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
        select: {
          totpSecret: true,
          totpEnabled: true,
          totpBackupCodes: true,
          lastTotpStep: true,
        },
      });

      if (!user?.totpEnabled || !user.totpSecret) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "2FA is not enabled.",
        });
      }

      const secret = decrypt(user.totpSecret);
      const matchedStep = verifyTotpCode(secret, input.code);
      // A replayed live code is treated as invalid, same as the login path.
      const codeValid =
        matchedStep !== null && !isTotpReplay(matchedStep, user.lastTotpStep);

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
          // Clear the consumed-step marker; a future re-enrolment starts fresh.
          lastTotpStep: null,
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

      await adminPrisma.$transaction(async (tx) => {
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

  /**
   * Admin-driven GDPR Art. 17 erasure.
   *
   * Lets an OWNER pseudonymise another OrgMember's User row when the
   * customer asks the org to delete a former employee's account. The
   * transaction body mirrors `eraseSelf` — same anonymise-email,
   * same locked-out-of-future-signin invariants — but is initiated by
   * an OWNER, not the target themselves.
   *
   * Constraints:
   *   - Caller MUST be `OrgMember.role === "OWNER"` in the resolved org.
   *   - Caller MUST NOT be the target (callers erase themselves via
   *     `eraseSelf`, which also re-confirms credentials).
   *   - Target MUST be a current OrgMember of the caller's org.
   *   - Target MUST NOT be OWNER. Demote / `transferOwnership` first
   *     so the org can never end up ownerless because of an erasure.
   *   - The `reason` field is recorded in the audit row metadata so a
   *     compliance review can trace why the erasure happened.
   *
   * Cross-org safety: we resolve target membership inside the same
   * `ctx.organizationId` scope, so a caller cannot erase a user that
   * belongs to a different organisation.
   */
  eraseUser: protectedProcedure
    .use(denyInDemo())
    .input(
      z.object({
        targetUserId: z.string().min(1),
        reason: z
          .string()
          .min(12, "Provide a reason of at least 12 characters for the audit log.")
          .max(2000),
      }),
    )
    .use(withAudit("user.erased_by_admin", "User"))
    .mutation(async ({ ctx, input }) => {
      const orgMemberRole = (ctx as { orgMemberRole?: string }).orgMemberRole;
      if (orgMemberRole !== "OWNER") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Erasing another user's account requires the OWNER role.",
        });
      }
      const callerId = ctx.session?.user?.id;
      if (!callerId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      if (callerId === input.targetUserId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Use `user.eraseSelf` to erase your own account (it re-confirms your credentials).",
        });
      }

      const organizationId = ctx.organizationId;

      // Resolve the target's OrgMember row within the caller's org.
      // If absent, the user either doesn't exist or belongs to another
      // org — either way the caller has no authority to erase them.
      const targetMembership = await prisma.orgMember.findUnique({
        where: {
          userId_organizationId: {
            userId: input.targetUserId,
            organizationId,
          },
        },
        select: { id: true, role: true },
      });
      if (!targetMembership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Target user is not a member of this organisation.",
        });
      }
      if (targetMembership.role === "OWNER") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Cannot erase an OWNER. Transfer ownership to another member first, then erase.",
        });
      }

      const target = await prisma.user.findUnique({
        where: { id: input.targetUserId },
        select: { id: true, email: true },
      });
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Codex PR #378 P1 — the caller's authority is bounded by their
      // organisation. Tear down EVERY membership tying the target to
      // THIS org first; only escalate to full User-row pseudonymisation
      // when the target has no other org memberships left after that.
      // A caller cannot reach into another customer's data.
      const result = await adminPrisma.$transaction(async (tx) => {
        // Codex PR #378 round-2 P1 — serialise concurrent
        // erase/membership writes on the same user. Without the lock
        // a peer org could OrgMember.create the target between our
        // `orgMember.count` and the full-erasure update; the count
        // returns 0, we pseudonymise, and the new membership ends up
        // pointing at an erased User row. Postgres advisory locks
        // serialise on userId; releases on commit/abort.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vf:user-erase:${target.id}`})::bigint)`;

        // 1. Drop org-scoped relations for caller's org only.
        await tx.orgMember.deleteMany({
          where: { userId: target.id, organizationId },
        });
        await tx.teamMember.deleteMany({
          where: { userId: target.id, team: { organizationId } },
        });

        // ScimGroup is intentionally single-tenant in the OSS schema
        // (no organizationId column). Multi-tenant SCIM is a follow-up
        // — for now, dropping the target's ScimGroupMember rows is
        // scoped to this OSS install which IS one tenant.
        await tx.scimGroupMember.deleteMany({ where: { userId: target.id } });

        // 2. Anonymise AuditLog rows that reference the target IN
        //    this org only. Other orgs' audit history stays intact
        //    and continues to attribute past actions to the target's
        //    User row (which we may keep alive below).
        await tx.auditLog.updateMany({
          where: { userId: target.id, organizationId },
          data: { userId: null },
        });

        // 3. Check whether the target still belongs to any org after
        //    this delete. If so, we MUST NOT touch the User row,
        //    WebAuthn credentials, accounts, or PlatformOperator —
        //    those would corrupt the target's identity in orgs the
        //    caller has no authority over.
        const remainingMemberships = await tx.orgMember.count({
          where: { userId: target.id },
        });

        if (remainingMemberships > 0) {
          return {
            id: target.id,
            erasureScope: "this_org_only" as const,
            remainingOrgMemberships: remainingMemberships,
          };
        }

        // 4. No other memberships — the target belongs only to this
        //    org. Pseudonymise the User row + drop user-level
        //    relations (same shape as `eraseSelf`). This is the full
        //    Art. 17 path.
        const anonEmail = `erased+${target.id}@anon.invalid`;
        await tx.webAuthnCredential.deleteMany({ where: { userId: target.id } });
        await tx.account.deleteMany({ where: { userId: target.id } });
        await tx.userPreference.deleteMany({ where: { userId: target.id } });
        await tx.dashboardView.deleteMany({ where: { userId: target.id } });

        // Also blank cross-org audit rows now that the User itself
        // is being pseudonymised — keeping the historical attribution
        // would point at a row whose PII columns we're about to wipe.
        await tx.auditLog.updateMany({
          where: { userId: target.id },
          data: { userId: null },
        });

        await tx.user.update({
          where: { id: target.id },
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
            lockedAt: new Date(),
            lockedBy: "erasure",
          },
        });

        // Soft-delete a matching PlatformOperator row (single-tenant
        // installs may have minted one tied to the user's email).
        const operator = await tx.platformOperator.findUnique({
          where: { email: target.email },
          select: { id: true, deletedAt: true },
        });
        if (operator && !operator.deletedAt) {
          await tx.platformOperator.update({
            where: { id: operator.id },
            data: { deletedAt: new Date() },
          });
        }

        return {
          id: target.id,
          erasureScope: "full" as const,
          remainingOrgMemberships: 0,
        };
      });

      return {
        id: result.id,
        erasedBy: callerId,
        reason: input.reason,
        erased: true,
        erasureScope: result.erasureScope,
        remainingOrgMemberships: result.remainingOrgMemberships,
      };
    }),
});