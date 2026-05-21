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
    it("creates the initial OWNER user, org membership, team, and system settings", async () => {
      const mockUser = {
        id: "user-1",
        email: "admin@example.com",
        name: "Admin",
      };
      const mockTeam = { id: "team-1", name: "My Org" };

      prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
        if (typeof fn !== "function") return;
        const tx = {
          user: {
            count: vi.fn().mockResolvedValue(0),
            create: vi.fn().mockResolvedValue(mockUser),
          },
          $executeRawUnsafe: vi.fn().mockResolvedValue(0),
          team: {
            create: vi.fn().mockResolvedValue(mockTeam),
            update: vi.fn().mockResolvedValue(mockTeam),
          },
          teamMember: {
            create: vi.fn().mockResolvedValue({
              userId: "user-1",
              teamId: "team-1",
              role: "ADMIN",
            }),
          },
          environment: {
            create: vi.fn().mockResolvedValue({ id: "env-1", name: "Production" }),
          },
          systemSettings: {
            upsert: vi.fn().mockResolvedValue({ id: "singleton" }),
          },
          orgMember: {
            create: vi.fn().mockResolvedValue({
              userId: "user-1",
              organizationId: "default",
              role: "OWNER",
            }),
          },
          platformOperator: { create: vi.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });

      const result = await completeSetup({
        email: "admin@example.com",
        name: "Admin",
        password: "securePassword123",
        teamName: "My Org",
        telemetryChoice: "yes",
        requireTwoFactor: false,
        environmentName: "Production",
      });

      expect(result.user.email).toBe("admin@example.com");
      expect(result.team.name).toBe("My Org");
    });

    it("hashes the password before storing", async () => {
      const bcrypt = await import("bcryptjs");

      prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
        if (typeof fn !== "function") return;
        const tx = {
          user: {
            count: vi.fn().mockResolvedValue(0),
            create: vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => {
              // Verify the password is hashed, not plaintext
              expect(args.data.passwordHash).toBe("$2a$12$hashed");
              expect(args.data.passwordHash).not.toBe("myPassword");
              return {
                id: "user-1",
                email: "admin@example.com",
                name: "Admin",
              };
            }),
          },
          $executeRawUnsafe: vi.fn().mockResolvedValue(0),
          team: { create: vi.fn().mockResolvedValue({ id: "team-1", name: "T" }), update: vi.fn().mockResolvedValue({}) },
          teamMember: { create: vi.fn().mockResolvedValue({}) },
          environment: { create: vi.fn().mockResolvedValue({ id: "env-1", name: "Prod" }) },
          systemSettings: { upsert: vi.fn().mockResolvedValue({}) },
          orgMember: { create: vi.fn().mockResolvedValue({}) },
          platformOperator: { create: vi.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });

      await completeSetup({
        email: "admin@example.com",
        name: "Admin",
        password: "myPassword",
        teamName: "Test Team",
        telemetryChoice: "no",
        requireTwoFactor: false,
        environmentName: "Production",
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
      requireTwoFactor: false,
      environmentName: "Production",
    };

    function makeTx(upsertMock: ReturnType<typeof vi.fn>) {
      return {
        $executeRawUnsafe: vi.fn().mockResolvedValue(0),
        user: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: "u1", email: "admin@example.com", name: "Admin" }) },
        team: { create: vi.fn().mockResolvedValue({ id: "t1", name: "Default" }), update: vi.fn().mockResolvedValue({}) },
        teamMember: { create: vi.fn().mockResolvedValue({}) },
        environment: { create: vi.fn().mockResolvedValue({ id: "e1", name: "Production" }) },
        systemSettings: { upsert: upsertMock },
        orgMember: { create: vi.fn().mockResolvedValue({}) },
        platformOperator: { create: vi.fn().mockResolvedValue({}) },
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

  describe("completeSetup — org wiring", () => {
    it("creates an OrgMember row binding the new user to DEFAULT_ORG_ID as OWNER", async () => {
      const orgMemberCreate = vi.fn().mockResolvedValue({});
      prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
        if (typeof fn !== "function") return;
        const tx = {
          $executeRawUnsafe: vi.fn().mockResolvedValue(0),
          user: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: "u1", email: "a@b.c", name: "A" }) },
          team: { create: vi.fn().mockResolvedValue({ id: "t1" }), update: vi.fn().mockResolvedValue({}) },
          teamMember: { create: vi.fn().mockResolvedValue({}) },
          environment: { create: vi.fn().mockResolvedValue({ id: "e1" }) },
          systemSettings: { upsert: vi.fn().mockResolvedValue({}) },
          orgMember: { create: orgMemberCreate },
          platformOperator: { create: vi.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });

      await completeSetup({
        email: "a@b.c",
        name: "A",
        password: "pw1234",
        teamName: "T",
        telemetryChoice: "no",
        requireTwoFactor: false,
        environmentName: "P",
      });

      expect(orgMemberCreate).toHaveBeenCalledWith({
        data: {
          userId: "u1",
          organizationId: "default",
          role: "OWNER",
        },
      });
    });

    it("sets organizationId on Team and Environment rows explicitly", async () => {
      let teamData: Record<string, unknown> | undefined;
      let envData: Record<string, unknown> | undefined;
      prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
        if (typeof fn !== "function") return;
        const tx = {
          $executeRawUnsafe: vi.fn().mockResolvedValue(0),
          user: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: "u1" }) },
          team: {
            create: vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => {
              teamData = args.data;
              return { id: "t1" };
            }),
            update: vi.fn().mockResolvedValue({}),
          },
          teamMember: { create: vi.fn().mockResolvedValue({}) },
          environment: {
            create: vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => {
              envData = args.data;
              return { id: "e1" };
            }),
          },
          systemSettings: { upsert: vi.fn().mockResolvedValue({}) },
          orgMember: { create: vi.fn().mockResolvedValue({}) },
          platformOperator: { create: vi.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });

      await completeSetup({
        email: "a@b.c",
        name: "A",
        password: "pw1234",
        teamName: "T",
        telemetryChoice: "no",
        requireTwoFactor: false,
        environmentName: "P",
      });

      expect(teamData?.organizationId).toBe("default");
      expect(envData?.organizationId).toBe("default");
    });

    it("creates a PlatformOperator with INCIDENT role for the initial admin (OSS gate)", async () => {
      const platformOperatorCreate = vi.fn().mockResolvedValue({});
      prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
        if (typeof fn !== "function") return;
        const tx = {
          $executeRawUnsafe: vi.fn().mockResolvedValue(0),
          user: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: "u1", email: "owner@example.com", name: "Owner" }) },
          team: { create: vi.fn().mockResolvedValue({ id: "t1" }), update: vi.fn().mockResolvedValue({}) },
          teamMember: { create: vi.fn().mockResolvedValue({}) },
          environment: { create: vi.fn().mockResolvedValue({ id: "e1" }) },
          systemSettings: { upsert: vi.fn().mockResolvedValue({}) },
          orgMember: { create: vi.fn().mockResolvedValue({}) },
          platformOperator: { create: platformOperatorCreate },
        };
        return fn(tx);
      });

      await completeSetup({
        email: "owner@example.com",
        name: "Owner",
        password: "pw1234",
        teamName: "T",
        telemetryChoice: "no",
        requireTwoFactor: false,
        environmentName: "P",
      });

      expect(platformOperatorCreate).toHaveBeenCalledWith({
        data: {
          email: "owner@example.com",
          name: "Owner",
          role: "INCIDENT",
        },
      });
    });

    it("skips PlatformOperator creation under the strict multi-tenant mode", async () => {
      const platformOperatorCreate = vi.fn().mockResolvedValue({});
      const ORIG = process.env.VF_STRICT_MULTI_TENANT;
      process.env.VF_STRICT_MULTI_TENANT = "true";
      try {
        prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
          if (typeof fn !== "function") return;
          const tx = {
            $executeRawUnsafe: vi.fn().mockResolvedValue(0),
            user: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: "u1", email: "a@b.c", name: "A" }) },
            team: { create: vi.fn().mockResolvedValue({ id: "t1" }), update: vi.fn().mockResolvedValue({}) },
            teamMember: { create: vi.fn().mockResolvedValue({}) },
            environment: { create: vi.fn().mockResolvedValue({ id: "e1" }) },
            systemSettings: { upsert: vi.fn().mockResolvedValue({}) },
            orgMember: { create: vi.fn().mockResolvedValue({}) },
            platformOperator: { create: platformOperatorCreate },
          };
          return fn(tx);
        });

        await completeSetup({
          email: "a@b.c",
          name: "A",
          password: "pw1234",
          teamName: "T",
          telemetryChoice: "no",
          requireTwoFactor: false,
          environmentName: "P",
        });

        expect(platformOperatorCreate).not.toHaveBeenCalled();
      } finally {
        if (ORIG === undefined) delete process.env.VF_STRICT_MULTI_TENANT;
        else process.env.VF_STRICT_MULTI_TENANT = ORIG;
      }
    });
  });
});

describe("completeSetup TOCTOU guard", () => {
  it("throws SetupAlreadyCompletedError when a concurrent caller has already created a user", async () => {
    // Simulate the case where another tx has committed a user row between
    // the route's isSetupRequired() pre-check and the in-tx re-check.
    const { SetupAlreadyCompletedError } = await import(
      "@/server/services/setup"
    );
    prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
      if (typeof fn !== "function") return;
      const tx = {
        $executeRawUnsafe: vi.fn().mockResolvedValue(0),
        // userCount > 0 → second caller observes the existing admin and aborts
        user: { count: vi.fn().mockResolvedValue(1), create: vi.fn() },
      };
      return fn(tx);
    });
    await expect(
      completeSetup({
        email: "racer@example.com",
        name: "Racer",
        password: "pw1234",
        teamName: "T",
        telemetryChoice: "no",
        requireTwoFactor: false,
        environmentName: "P",
      }),
    ).rejects.toBeInstanceOf(SetupAlreadyCompletedError);
  });
});
