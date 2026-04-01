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
    requireSuperAdmin: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/server/middleware/audit", () => ({
  withAudit: () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn().mockResolvedValue(true),
    hash: vi.fn().mockResolvedValue("hashed-new-password"),
  },
}));

vi.mock("@/server/services/totp", () => ({
  generateTotpSecret: vi.fn().mockReturnValue({ secret: "TOTP_SECRET", uri: "otpauth://totp/test" }),
  verifyTotpCode: vi.fn().mockReturnValue(true),
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

const caller = t.createCallerFactory(userRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

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
        isSuperAdmin: false,
        memberships: [{ team: { requireTwoFactor: false } }],
      } as never);

      const result = await caller.me();

      expect(result).toEqual({
        name: "Test User",
        email: "test@test.com",
        authMethod: "LOCAL",
        mustChangePassword: false,
        totpEnabled: false,
        isSuperAdmin: false,
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
        isSuperAdmin: false,
        memberships: [{ team: { requireTwoFactor: true } }],
      } as never);

      const result = await caller.me();

      expect(result.twoFactorRequired).toBe(true);
    });

    it("sets twoFactorRequired true for super admins", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        name: "Admin",
        email: "admin@test.com",
        authMethod: "LOCAL",
        mustChangePassword: false,
        totpEnabled: false,
        isSuperAdmin: true,
        memberships: [],
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
        isSuperAdmin: true,
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
      vi.mocked(verifyTotpCode).mockReturnValueOnce(false);

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
        data: { totpEnabled: false, totpSecret: null, totpBackupCodes: null },
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
      vi.mocked(verifyTotpCode).mockReturnValueOnce(false);
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
      vi.mocked(verifyTotpCode).mockReturnValueOnce(false);
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
});
