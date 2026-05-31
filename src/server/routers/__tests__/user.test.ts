import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { t } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return { t };
});

vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx }));
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    withTeamAccess: passthrough,
    requirePlatformOperator: passthrough,
    denyInDemo: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/server/middleware/audit", () => ({
  withAudit: () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx })),
}));

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn().mockResolvedValue(true),
    hash: vi.fn().mockResolvedValue("hashed-new-password"),
  },
}));

vi.mock("@/server/services/totp", () => ({
  generateTotpSecret: vi.fn().mockReturnValue({ secret: "TOTP_SECRET", uri: "otpauth://totp/test" }),
  // verifyTotpCode now returns the matched absolute time-step (a number) on
  // success or null on failure (VF-16).
  verifyTotpCode: vi.fn().mockReturnValue(1000),
  generateBackupCodes: vi.fn().mockReturnValue(["CODE1", "CODE2", "CODE3"]),
  hashBackupCode: vi.fn((code: string) => `hashed:${code}`),
  verifyBackupCode: vi.fn().mockReturnValue({ valid: false, remaining: [] }),
}));

vi.mock("@/server/services/crypto", () => ({
  encrypt: vi.fn((val: string) => `enc:${val}`),
  decrypt: vi.fn((val: string) => val.replace("enc:", "")),
}));

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { userRouter } from "@/server/routers/user";
import bcrypt from "bcryptjs";
import { verifyTotpCode, verifyBackupCode } from "@/server/services/totp";
import { decrypt } from "@/server/services/crypto";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const callerFactory = t.createCallerFactory(userRouter);

const caller = callerFactory({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

function ownerCaller() {
  return callerFactory({
    session: { user: { id: "owner-1", email: "owner@test.com", name: "Owner" } },
    userRole: "OWNER",
    teamId: "team-1",
    organizationId: "org-a",
    orgMemberRole: "OWNER",
  });
}

function memberCaller() {
  return callerFactory({
    session: { user: { id: "member-1", email: "member@test.com", name: "Member" } },
    userRole: "MEMBER",
    teamId: "team-1",
    organizationId: "org-a",
    orgMemberRole: "MEMBER",
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("userRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ─── me ───────────────────────────────────────────────────────────────────

  describe("me", () => {
    it("returns current user info with 2FA status", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        name: "Test User",
        email: "test@test.com",
        authMethod: "LOCAL",
        mustChangePassword: false,
        totpEnabled: false,
        memberships: [{ team: { requireTwoFactor: false } }],
      } as never);

      const result = await caller.me();

      expect(result).toEqual({
        name: "Test User",
        email: "test@test.com",
        authMethod: "LOCAL",
        mustChangePassword: false,
        totpEnabled: false,
        isOrgAdmin: false,
        isPlatformOperator: false,
        twoFactorRequired: false,
      });
    });

    it("sets twoFactorRequired true when team requires 2FA", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        name: "Test User",
        email: "test@test.com",
        authMethod: "LOCAL",
        mustChangePassword: false,
        totpEnabled: false,
        memberships: [{ team: { requireTwoFactor: true } }],
      } as never);

      const result = await caller.me();

      expect(result.twoFactorRequired).toBe(true);
    });

    it("does not require 2FA for super admins without team policy", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        name: "Admin",
        email: "admin@test.com",
        authMethod: "LOCAL",
        mustChangePassword: false,
        totpEnabled: false,
        memberships: [],
      } as never);

      const result = await caller.me();

      expect(result.twoFactorRequired).toBe(false);
    });

    it("requires 2FA for super admins when team policy is enabled", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        name: "Admin",
        email: "admin@test.com",
        authMethod: "LOCAL",
        mustChangePassword: false,
        totpEnabled: false,
        memberships: [{ team: { requireTwoFactor: true } }],
      } as never);

      const result = await caller.me();

      expect(result.twoFactorRequired).toBe(true);
    });

    it("sets twoFactorRequired false for OIDC users even with super admin", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        name: "OIDC Admin",
        email: "oidc@test.com",
        authMethod: "OIDC",
        mustChangePassword: false,
        totpEnabled: false,
        memberships: [{ team: { requireTwoFactor: true } }],
      } as never);

      const result = await caller.me();

      expect(result.twoFactorRequired).toBe(false);
    });
  });

  // ─── changePassword ───────────────────────────────────────────────────────

  describe("changePassword", () => {
    it("changes password when current password is correct", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        passwordHash: "old-hash",
        authMethod: "LOCAL",
      } as never);
      prismaMock.user.update.mockResolvedValue({} as never);

      const result = await caller.changePassword({
        currentPassword: "old-pass",
        newPassword: "new-password-123",
      });

      expect(bcrypt.compare).toHaveBeenCalledWith("old-pass", "old-hash");
      expect(bcrypt.hash).toHaveBeenCalledWith("new-password-123", 12);
      expect(result).toEqual({ success: true });
    });

    it("throws BAD_REQUEST when current password is wrong", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        passwordHash: "old-hash",
        authMethod: "LOCAL",
      } as never);
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);

      await expect(
        caller.changePassword({ currentPassword: "wrong", newPassword: "new-password-123" }),
      ).rejects.toThrow("Current password is incorrect");
    });

    it("throws BAD_REQUEST for OIDC users", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        passwordHash: null,
        authMethod: "OIDC",
      } as never);

      await expect(
        caller.changePassword({ currentPassword: "pass", newPassword: "new-pass-123" }),
      ).rejects.toThrow("Password change not available for SSO users");
    });

    it("throws NOT_FOUND when user does not exist", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null as never);

      await expect(
        caller.changePassword({ currentPassword: "pass", newPassword: "new-pass-123" }),
      ).rejects.toThrow("User not found");
    });
  });

  // ─── updateProfile ────────────────────────────────────────────────────────

  describe("updateProfile", () => {
    it("updates user name for LOCAL users", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ authMethod: "LOCAL" } as never);
      const updated = { id: "user-1", name: "New Name", email: "test@test.com" };
      prismaMock.user.update.mockResolvedValue(updated as never);

      const result = await caller.updateProfile({ name: "New Name" });

      expect(result).toEqual(updated);
    });

    it("throws BAD_REQUEST for OIDC users", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ authMethod: "OIDC" } as never);

      await expect(
        caller.updateProfile({ name: "New Name" }),
      ).rejects.toThrow("Profile editing is not available for SSO users");
    });
  });

  // ─── setupTotp ────────────────────────────────────────────────────────────

  describe("setupTotp", () => {
    it("generates TOTP secret and backup codes", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        email: "test@test.com",
        totpEnabled: false,
        authMethod: "LOCAL",
      } as never);
      prismaMock.user.update.mockResolvedValue({} as never);

      const result = await caller.setupTotp();

      expect(result).toEqual({
        uri: "otpauth://totp/test",
        secret: "TOTP_SECRET",
        backupCodes: ["CODE1", "CODE2", "CODE3"],
      });
    });

    it("throws BAD_REQUEST when TOTP already enabled", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        email: "test@test.com",
        totpEnabled: true,
        authMethod: "LOCAL",
      } as never);

      await expect(caller.setupTotp()).rejects.toThrow(
        "2FA is already enabled",
      );
    });

    it("throws BAD_REQUEST for OIDC users", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        email: "test@test.com",
        totpEnabled: false,
        authMethod: "OIDC",
      } as never);

      await expect(caller.setupTotp()).rejects.toThrow(
        "2FA is managed by your SSO provider",
      );
    });
  });

  // ─── verifyAndEnableTotp ──────────────────────────────────────────────────

  describe("verifyAndEnableTotp", () => {
    it("enables TOTP with valid code", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        totpSecret: "enc:TOTP_SECRET",
        totpEnabled: false,
      } as never);
      prismaMock.user.update.mockResolvedValue({} as never);

      const result = await caller.verifyAndEnableTotp({ code: "123456" });

      expect(decrypt).toHaveBeenCalledWith("enc:TOTP_SECRET");
      expect(verifyTotpCode).toHaveBeenCalledWith("TOTP_SECRET", "123456");
      expect(result).toEqual({ enabled: true });
    });

    it("throws BAD_REQUEST with invalid code", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        totpSecret: "enc:TOTP_SECRET",
        totpEnabled: false,
      } as never);
      vi.mocked(verifyTotpCode).mockReturnValueOnce(null);

      await expect(
        caller.verifyAndEnableTotp({ code: "000000" }),
      ).rejects.toThrow("Invalid verification code");
    });

    it("throws BAD_REQUEST when no setup in progress", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        totpSecret: null,
        totpEnabled: false,
      } as never);

      await expect(
        caller.verifyAndEnableTotp({ code: "123456" }),
      ).rejects.toThrow("No TOTP setup in progress");
    });
  });

  // ─── disableTotp ──────────────────────────────────────────────────────────

  describe("disableTotp", () => {
    it("disables TOTP with valid code", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        totpSecret: "enc:TOTP_SECRET",
        totpEnabled: true,
        totpBackupCodes: null,
      } as never);
      prismaMock.user.update.mockResolvedValue({} as never);

      const result = await caller.disableTotp({ code: "123456" });

      expect(result).toEqual({ disabled: true });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: {
          totpEnabled: false,
          totpSecret: null,
          totpBackupCodes: null,
          lastTotpStep: null,
        },
      });
    });

    it("disables TOTP with valid backup code", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        totpSecret: "enc:TOTP_SECRET",
        totpEnabled: true,
        totpBackupCodes: 'enc:["hashed:CODE1","hashed:CODE2"]',
      } as never);
      prismaMock.user.update.mockResolvedValue({} as never);
      // TOTP code invalid, backup code valid
      vi.mocked(verifyTotpCode).mockReturnValueOnce(null);
      vi.mocked(verifyBackupCode).mockReturnValueOnce({ valid: true, remaining: ["hashed:CODE2"] });

      const result = await caller.disableTotp({ code: "BACKUP1" });

      expect(result).toEqual({ disabled: true });
    });

    it("throws BAD_REQUEST when both code and backup are invalid", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        totpSecret: "enc:TOTP_SECRET",
        totpEnabled: true,
        totpBackupCodes: 'enc:["hashed:CODE1"]',
      } as never);
      vi.mocked(verifyTotpCode).mockReturnValueOnce(null);
      vi.mocked(verifyBackupCode).mockReturnValueOnce({ valid: false, remaining: [] });

      await expect(
        caller.disableTotp({ code: "000000" }),
      ).rejects.toThrow("Invalid code");
    });

    it("throws BAD_REQUEST when TOTP is not enabled", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        totpSecret: null,
        totpEnabled: false,
        totpBackupCodes: null,
      } as never);

      await expect(
        caller.disableTotp({ code: "123456" }),
      ).rejects.toThrow("2FA is not enabled");
    });
  });

  // ─── eraseSelf ────────────────────────────────────────────────────────────

  describe("eraseSelf", () => {
    function setupHappyPath(overrides: { authMethod?: string } = {}) {
      prismaMock.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "test@test.com",
        passwordHash: "hash",
        authMethod: overrides.authMethod ?? "LOCAL",
      } as never);
      prismaMock.orgMember.findMany.mockResolvedValue([]);
      prismaMock.platformOperator.findUnique.mockResolvedValue(null);
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: PrismaClient) => Promise<unknown>) => fn(prismaMock),
      );
      // Reset deleteMany/update/findMany return values.
      prismaMock.orgMember.deleteMany.mockResolvedValue({ count: 0 } as never);
      prismaMock.teamMember.deleteMany.mockResolvedValue({ count: 0 } as never);
      prismaMock.scimGroupMember.deleteMany.mockResolvedValue({ count: 0 } as never);
      prismaMock.webAuthnCredential.deleteMany.mockResolvedValue({ count: 0 } as never);
      prismaMock.account.deleteMany.mockResolvedValue({ count: 0 } as never);
      prismaMock.userPreference.deleteMany.mockResolvedValue({ count: 0 } as never);
      prismaMock.dashboardView.deleteMany.mockResolvedValue({ count: 0 } as never);
      prismaMock.auditLog.updateMany.mockResolvedValue({ count: 0 } as never);
      prismaMock.user.update.mockResolvedValue({} as never);
    }

    it("rejects when caller is the sole OWNER of an org with other members", async () => {
      setupHappyPath();
      prismaMock.orgMember.findMany.mockResolvedValue([
        { organizationId: "org-a" },
      ] as never);
      // count() called twice per org: other members, other owners.
      prismaMock.orgMember.count
        .mockResolvedValueOnce(2 as never) // other members exist
        .mockResolvedValueOnce(0 as never); // no other owners

      await expect(
        caller.eraseSelf({
          confirmation: "erase my account",
          currentPassword: "secret",
        }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringMatching(/sole OWNER/i),
      });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("requires current password for LOCAL auth", async () => {
      setupHappyPath();
      await expect(
        caller.eraseSelf({ confirmation: "erase my account" }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringMatching(/Current password is required/),
      });
    });

    it("rejects when current password does not match", async () => {
      setupHappyPath();
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);
      await expect(
        caller.eraseSelf({
          confirmation: "erase my account",
          currentPassword: "wrong",
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringMatching(/incorrect/i),
      });
    });

    it("pseudonymises the user row and deletes auth-bearing relations", async () => {
      setupHappyPath();

      const result = await caller.eraseSelf({
        confirmation: "erase my account",
        currentPassword: "secret",
      });

      expect(result).toEqual({ id: "user-1", erased: true });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

      expect(prismaMock.orgMember.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
      });
      expect(prismaMock.webAuthnCredential.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
      });
      expect(prismaMock.account.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
      });
      expect(prismaMock.auditLog.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        data: { userId: null },
      });

      const updateCall = prismaMock.user.update.mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: "user-1" });
      expect(updateCall.data).toMatchObject({
        email: "erased+user-1@anon.invalid",
        name: null,
        image: null,
        passwordHash: null,
        totpEnabled: false,
        totpSecret: null,
        totpBackupCodes: null,
        scimExternalId: null,
        lockedBy: "erasure",
      });
      expect(updateCall.data.lockedAt).toBeInstanceOf(Date);
    });

    it("soft-deletes the matching PlatformOperator row", async () => {
      setupHappyPath();
      prismaMock.platformOperator.findUnique.mockResolvedValue({
        id: "op-1",
        deletedAt: null,
      } as never);

      await caller.eraseSelf({
        confirmation: "erase my account",
        currentPassword: "secret",
      });

      expect(prismaMock.platformOperator.update).toHaveBeenCalledWith({
        where: { id: "op-1" },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it("skips PlatformOperator update when row is already soft-deleted", async () => {
      setupHappyPath();
      prismaMock.platformOperator.findUnique.mockResolvedValue({
        id: "op-1",
        deletedAt: new Date("2026-01-01"),
      } as never);

      await caller.eraseSelf({
        confirmation: "erase my account",
        currentPassword: "secret",
      });

      expect(prismaMock.platformOperator.update).not.toHaveBeenCalled();
    });

    it("OIDC auth skips password confirmation", async () => {
      setupHappyPath({ authMethod: "OIDC" });
      const result = await caller.eraseSelf({
        confirmation: "erase my account",
      });
      expect(result).toEqual({ id: "user-1", erased: true });
      expect(prismaMock.user.update).toHaveBeenCalled();
    });

    it("rejects when confirmation literal is missing", async () => {
      await expect(
        caller.eraseSelf({ currentPassword: "secret" } as Parameters<
          typeof caller.eraseSelf
        >[0]),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ─── eraseUser (admin-driven Art. 17) ─────────────────────────────────────

  describe("eraseUser", () => {
    function setupOwnerHappyPath(opts: {
      targetRole?: "MEMBER" | "ADMIN" | "OWNER";
      remainingMemberships?: number;
    } = {}) {
      prismaMock.orgMember.findUnique.mockResolvedValue({
        id: "om-target",
        role: opts.targetRole ?? "MEMBER",
      } as never);
      prismaMock.user.findUnique.mockResolvedValue({
        id: "target-1",
        email: "target@test.com",
      } as never);
      prismaMock.platformOperator.findUnique.mockResolvedValue(null);
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: PrismaClient) => Promise<unknown>) => fn(prismaMock),
      );
      prismaMock.$executeRaw.mockResolvedValue(1 as never);
      prismaMock.orgMember.deleteMany.mockResolvedValue({ count: 1 } as never);
      prismaMock.teamMember.deleteMany.mockResolvedValue({ count: 0 } as never);
      prismaMock.scimGroupMember.deleteMany.mockResolvedValue({ count: 0 } as never);
      prismaMock.webAuthnCredential.deleteMany.mockResolvedValue({ count: 0 } as never);
      prismaMock.account.deleteMany.mockResolvedValue({ count: 0 } as never);
      prismaMock.userPreference.deleteMany.mockResolvedValue({ count: 0 } as never);
      prismaMock.dashboardView.deleteMany.mockResolvedValue({ count: 0 } as never);
      prismaMock.auditLog.updateMany.mockResolvedValue({ count: 0 } as never);
      prismaMock.user.update.mockResolvedValue({} as never);
      // Default: target belongs only to caller's org (full erasure).
      // Tests that want the "partial erasure" path override.
      prismaMock.orgMember.count.mockResolvedValue(
        (opts.remainingMemberships ?? 0) as never,
      );
    }

    const goodInput = {
      targetUserId: "target-1",
      reason: "Former employee requested removal under GDPR Art. 17.",
    };

    it("refuses non-OWNER callers", async () => {
      setupOwnerHappyPath();
      await expect(
        memberCaller().eraseUser(goodInput),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringMatching(/OWNER/),
      });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("refuses self-erasure (must use eraseSelf)", async () => {
      setupOwnerHappyPath();
      await expect(
        ownerCaller().eraseUser({
          targetUserId: "owner-1", // same as caller
          reason: "self-erasure attempt",
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringMatching(/eraseSelf/i),
      });
    });

    it("refuses when target is not a member of the caller's org", async () => {
      prismaMock.orgMember.findUnique.mockResolvedValue(null);
      await expect(
        ownerCaller().eraseUser(goodInput),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringMatching(/not a member/i),
      });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("refuses when target is an OWNER (must transfer ownership first)", async () => {
      setupOwnerHappyPath({ targetRole: "OWNER" });
      await expect(
        ownerCaller().eraseUser(goodInput),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringMatching(/Transfer ownership/i),
      });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("rejects a too-short reason", async () => {
      await expect(
        ownerCaller().eraseUser({ targetUserId: "target-1", reason: "short" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("happy path (full erasure) — target only in caller's org", async () => {
      setupOwnerHappyPath({ targetRole: "MEMBER", remainingMemberships: 0 });

      const result = await ownerCaller().eraseUser(goodInput);

      expect(result).toMatchObject({
        id: "target-1",
        erasedBy: "owner-1",
        erased: true,
        erasureScope: "full",
        remainingOrgMemberships: 0,
        reason: goodInput.reason,
      });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(prismaMock.orgMember.deleteMany).toHaveBeenCalledWith({
        where: { userId: "target-1", organizationId: "org-a" },
      });
      expect(prismaMock.teamMember.deleteMany).toHaveBeenCalledWith({
        where: { userId: "target-1", team: { organizationId: "org-a" } },
      });
      expect(prismaMock.webAuthnCredential.deleteMany).toHaveBeenCalledWith({
        where: { userId: "target-1" },
      });
      // First updateMany scoped to org; second is the cross-org wipe.
      expect(prismaMock.auditLog.updateMany).toHaveBeenNthCalledWith(1, {
        where: { userId: "target-1", organizationId: "org-a" },
        data: { userId: null },
      });
      expect(prismaMock.auditLog.updateMany).toHaveBeenNthCalledWith(2, {
        where: { userId: "target-1" },
        data: { userId: null },
      });
      const updateCall = prismaMock.user.update.mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: "target-1" });
      expect(updateCall.data).toMatchObject({
        email: "erased+target-1@anon.invalid",
        name: null,
        passwordHash: null,
        lockedBy: "erasure",
      });
      expect(updateCall.data.lockedAt).toBeInstanceOf(Date);
    });

    it("partial erasure — target belongs to other orgs, only this-org links cleared", async () => {
      setupOwnerHappyPath({ targetRole: "MEMBER", remainingMemberships: 2 });

      const result = await ownerCaller().eraseUser(goodInput);

      expect(result).toMatchObject({
        id: "target-1",
        erasureScope: "this_org_only",
        remainingOrgMemberships: 2,
      });
      // Org-scoped deletes fire.
      expect(prismaMock.orgMember.deleteMany).toHaveBeenCalledWith({
        where: { userId: "target-1", organizationId: "org-a" },
      });
      expect(prismaMock.teamMember.deleteMany).toHaveBeenCalledWith({
        where: { userId: "target-1", team: { organizationId: "org-a" } },
      });
      // AuditLog row scoped to this org only.
      expect(prismaMock.auditLog.updateMany).toHaveBeenCalledWith({
        where: { userId: "target-1", organizationId: "org-a" },
        data: { userId: null },
      });
      // User-level erasure paths MUST NOT fire when target has other orgs.
      expect(prismaMock.webAuthnCredential.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.account.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.userPreference.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.dashboardView.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.user.update).not.toHaveBeenCalled();
      expect(prismaMock.platformOperator.update).not.toHaveBeenCalled();
    });

    it("soft-deletes a matching PlatformOperator row only on full erasure", async () => {
      setupOwnerHappyPath({ targetRole: "MEMBER", remainingMemberships: 0 });
      prismaMock.platformOperator.findUnique.mockResolvedValue({
        id: "op-target",
        deletedAt: null,
      } as never);

      await ownerCaller().eraseUser(goodInput);

      expect(prismaMock.platformOperator.update).toHaveBeenCalledWith({
        where: { id: "op-target" },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it("skips PlatformOperator soft-delete when target has other orgs", async () => {
      setupOwnerHappyPath({ targetRole: "MEMBER", remainingMemberships: 1 });
      prismaMock.platformOperator.findUnique.mockResolvedValue({
        id: "op-target",
        deletedAt: null,
      } as never);

      await ownerCaller().eraseUser(goodInput);

      // PlatformOperator stays alive — the target is still a member
      // of another org and the operator account may correspond to
      // their identity in that org.
      expect(prismaMock.platformOperator.update).not.toHaveBeenCalled();
    });
  });
});
