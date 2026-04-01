import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$2a$12$hashed"),
  },
}));

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { isSetupRequired, completeSetup } from "@/server/services/setup";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("setup service", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ─── isSetupRequired ───────────────────────────────────────────────────────

  describe("isSetupRequired", () => {
    it("returns true when no users exist", async () => {
      prismaMock.user.count.mockResolvedValue(0);

      const result = await isSetupRequired();

      expect(result).toBe(true);
    });

    it("returns false when users exist", async () => {
      prismaMock.user.count.mockResolvedValue(3);

      const result = await isSetupRequired();

      expect(result).toBe(false);
    });
  });

  // ─── completeSetup ────────────────────────────────────────────────────────

  describe("completeSetup", () => {
    it("creates a super admin user, team, membership, and system settings", async () => {
      const mockUser = {
        id: "user-1",
        email: "admin@example.com",
        name: "Admin",
        isSuperAdmin: true,
      };
      const mockTeam = { id: "team-1", name: "My Org" };

      prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          user: {
            create: vi.fn().mockResolvedValue(mockUser),
          },
          team: {
            create: vi.fn().mockResolvedValue(mockTeam),
          },
          teamMember: {
            create: vi.fn().mockResolvedValue({
              userId: "user-1",
              teamId: "team-1",
              role: "ADMIN",
            }),
          },
          systemSettings: {
            upsert: vi.fn().mockResolvedValue({ id: "singleton" }),
          },
        };
        return fn(tx);
      });

      const result = await completeSetup({
        email: "admin@example.com",
        name: "Admin",
        password: "securePassword123",
        teamName: "My Org",
      });

      expect(result.user.email).toBe("admin@example.com");
      expect(result.user.isSuperAdmin).toBe(true);
      expect(result.team.name).toBe("My Org");
    });

    it("hashes the password before storing", async () => {
      const bcrypt = await import("bcryptjs");

      prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          user: {
            create: vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => {
              // Verify the password is hashed, not plaintext
              expect(args.data.passwordHash).toBe("$2a$12$hashed");
              expect(args.data.passwordHash).not.toBe("myPassword");
              return {
                id: "user-1",
                email: "admin@example.com",
                name: "Admin",
                isSuperAdmin: true,
              };
            }),
          },
          team: { create: vi.fn().mockResolvedValue({ id: "team-1", name: "T" }) },
          teamMember: { create: vi.fn().mockResolvedValue({}) },
          systemSettings: { upsert: vi.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });

      await completeSetup({
        email: "admin@example.com",
        name: "Admin",
        password: "myPassword",
        teamName: "Test Team",
      });

      expect(bcrypt.default.hash).toHaveBeenCalledWith("myPassword", 12);
    });
  });
});
