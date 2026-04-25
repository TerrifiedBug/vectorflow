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

const { ulidGen } = vi.hoisted(() => ({ ulidGen: vi.fn() }));
vi.mock("ulid", () => ({ ulid: ulidGen }));

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

      prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
        if (typeof fn !== "function") return;
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
        telemetryChoice: "yes",
      });

      expect(result.user.email).toBe("admin@example.com");
      expect(result.user.isSuperAdmin).toBe(true);
      expect(result.team.name).toBe("My Org");
    });

    it("hashes the password before storing", async () => {
      const bcrypt = await import("bcryptjs");

      prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
        if (typeof fn !== "function") return;
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
        telemetryChoice: "no",
      });

      expect(bcrypt.default.hash).toHaveBeenCalledWith("myPassword", 12);
    });
  });

  // ─── completeSetup — telemetry choice ────────────────────────────────────

  describe("completeSetup — telemetry choice", () => {
    const baseInput = {
      name: "Admin",
      email: "admin@example.com",
      password: "secret123",
      teamName: "Default",
    };

    function makeTx(upsertMock: ReturnType<typeof vi.fn>) {
      return {
        user: { create: vi.fn().mockResolvedValue({ id: "u1", email: "admin@example.com", name: "Admin", isSuperAdmin: true }) },
        team: { create: vi.fn().mockResolvedValue({ id: "t1", name: "Default" }) },
        teamMember: { create: vi.fn().mockResolvedValue({}) },
        systemSettings: { upsert: upsertMock },
      };
    }

    it("'yes' generates ULID and writes enabled=true with timestamp", async () => {
      ulidGen.mockReturnValueOnce("01HX0000000000000000000000");
      const upsertMock = vi.fn().mockResolvedValue({ id: "singleton" });

      prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
        if (typeof fn !== "function") return;
        return fn(makeTx(upsertMock));
      });

      await completeSetup({ ...baseInput, telemetryChoice: "yes" });

      expect(upsertMock).toHaveBeenCalled();
      const args = upsertMock.mock.calls[0][0];
      expect(args.create.telemetryEnabled).toBe(true);
      expect(args.create.telemetryInstanceId).toBe("01HX0000000000000000000000");
      expect(args.create.telemetryEnabledAt).toBeInstanceOf(Date);
    });

    it("'no' writes enabled=false with null id and date", async () => {
      const upsertMock = vi.fn().mockResolvedValue({ id: "singleton" });

      prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
        if (typeof fn !== "function") return;
        return fn(makeTx(upsertMock));
      });

      await completeSetup({ ...baseInput, telemetryChoice: "no" });

      const args = upsertMock.mock.calls[0][0];
      expect(args.create.telemetryEnabled).toBe(false);
      expect(args.create.telemetryInstanceId).toBeNull();
      expect(args.create.telemetryEnabledAt).toBeNull();
      expect(ulidGen).not.toHaveBeenCalled();
    });
  });
});
