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

vi.mock("@/server/services/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed-password") },
}));

vi.mock("@/server/routers/team", () => ({
  assertManualAssignmentAllowed: vi.fn().mockResolvedValue(undefined),
}));

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { adminRouter } from "@/server/routers/admin";
import { assertManualAssignmentAllowed } from "@/server/routers/team";
import { writeAuditLog } from "@/server/services/audit";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const caller = t.createCallerFactory(adminRouter)({
  session: { user: { id: "user-1", email: "admin@test.com", name: "Admin" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("adminRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ─── listUsers ────────────────────────────────────────────────────────────

  describe("listUsers", () => {
    it("returns all users with memberships ordered by createdAt", async () => {
      const users = [
        { id: "u1", email: "a@test.com", name: "A", memberships: [] },
        { id: "u2", email: "b@test.com", name: "B", memberships: [] },
      ];
      prismaMock.user.findMany.mockResolvedValue(users as never);

      const result = await caller.listUsers();

      expect(result).toEqual(users);
      expect(prismaMock.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: "asc" } }),
      );
    });
  });

  // ─── assignToTeam ─────────────────────────────────────────────────────────

  describe("assignToTeam", () => {
    it("creates team membership for valid input", async () => {
      prismaMock.teamMember.findUnique.mockResolvedValue(null as never);
      const created = { id: "tm-1", userId: "u1", teamId: "t1", role: "EDITOR" };
      prismaMock.teamMember.create.mockResolvedValue(created as never);

      const result = await caller.assignToTeam({ userId: "u1", teamId: "t1", role: "EDITOR" });

      expect(assertManualAssignmentAllowed).toHaveBeenCalledWith("u1");
      expect(result).toEqual(created);
    });

    it("throws CONFLICT when user is already a team member", async () => {
      prismaMock.teamMember.findUnique.mockResolvedValue({ id: "existing" } as never);

      await expect(
        caller.assignToTeam({ userId: "u1", teamId: "t1", role: "VIEWER" }),
      ).rejects.toThrow("User is already a member of this team");
    });
  });

  // ─── removeFromTeam ───────────────────────────────────────────────────────

  describe("removeFromTeam", () => {
    it("deletes the team membership", async () => {
      prismaMock.teamMember.findUnique.mockResolvedValue({ id: "tm-1" } as never);
      prismaMock.teamMember.delete.mockResolvedValue({} as never);

      const result = await caller.removeFromTeam({ userId: "u1", teamId: "t1" });

      expect(result).toEqual({ removed: true });
      expect(prismaMock.teamMember.delete).toHaveBeenCalledWith({ where: { id: "tm-1" } });
    });

    it("throws NOT_FOUND when membership does not exist", async () => {
      prismaMock.teamMember.findUnique.mockResolvedValue(null as never);

      await expect(
        caller.removeFromTeam({ userId: "u1", teamId: "t1" }),
      ).rejects.toThrow("Team membership not found");
    });
  });

  // ─── deleteUser ───────────────────────────────────────────────────────────

  describe("deleteUser", () => {
    it("deletes user with cascading transaction", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: "u2", email: "u2@test.com", name: "User 2" } as never);
      prismaMock.$transaction.mockResolvedValue([] as never);

      const result = await caller.deleteUser({ userId: "u2" });

      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: null,
          action: "admin.user_deleted",
          entityId: "u2",
        }),
      );
      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(result).toEqual({ deleted: true });
    });

    it("throws BAD_REQUEST when deleting yourself", async () => {
      await expect(
        caller.deleteUser({ userId: "user-1" }),
      ).rejects.toThrow("Cannot delete yourself");
    });

    it("throws NOT_FOUND when user does not exist", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null as never);

      await expect(
        caller.deleteUser({ userId: "u-nonexistent" }),
      ).rejects.toThrow("User not found");
    });
  });

  // ─── toggleSuperAdmin ─────────────────────────────────────────────────────

  describe("toggleSuperAdmin", () => {
    it("updates super admin status", async () => {
      const updated = { id: "u2", isSuperAdmin: true };
      prismaMock.user.update.mockResolvedValue(updated as never);

      const result = await caller.toggleSuperAdmin({ userId: "u2", isSuperAdmin: true });

      expect(result).toEqual(updated);
    });

    it("throws BAD_REQUEST when removing own super admin", async () => {
      await expect(
        caller.toggleSuperAdmin({ userId: "user-1", isSuperAdmin: false }),
      ).rejects.toThrow("Cannot remove your own super admin status");
    });

    it("allows granting super admin to self (no-op but allowed)", async () => {
      prismaMock.user.update.mockResolvedValue({ id: "user-1", isSuperAdmin: true } as never);

      const result = await caller.toggleSuperAdmin({ userId: "user-1", isSuperAdmin: true });

      expect(result).toEqual({ id: "user-1", isSuperAdmin: true });
    });
  });

  // ─── createUser ───────────────────────────────────────────────────────────

  describe("createUser", () => {
    it("creates user with generated password", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null as never);
      prismaMock.user.create.mockResolvedValue({
        id: "new-user",
        email: "new@test.com",
        name: "New User",
      } as never);

      const result = await caller.createUser({ email: "new@test.com", name: "New User" });

      expect(result).toMatchObject({
        id: "new-user",
        email: "new@test.com",
        name: "New User",
      });
      expect(result.generatedPassword).toBeDefined();
      expect(prismaMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: "new@test.com",
            name: "New User",
            authMethod: "LOCAL",
            mustChangePassword: true,
          }),
        }),
      );
    });

    it("assigns to team when teamId and role provided", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null as never);
      prismaMock.user.create.mockResolvedValue({
        id: "new-user",
        email: "new@test.com",
        name: "New User",
      } as never);
      prismaMock.teamMember.create.mockResolvedValue({} as never);

      await caller.createUser({
        email: "new@test.com",
        name: "New User",
        teamId: "t1",
        role: "EDITOR",
      });

      expect(prismaMock.teamMember.create).toHaveBeenCalledWith({
        data: { userId: "new-user", teamId: "t1", role: "EDITOR" },
      });
    });

    it("throws CONFLICT when email already exists", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: "existing" } as never);

      await expect(
        caller.createUser({ email: "existing@test.com", name: "Dup" }),
      ).rejects.toThrow("A user with this email already exists");
    });
  });

  // ─── lockUser ─────────────────────────────────────────────────────────────

  describe("lockUser", () => {
    it("locks a user account", async () => {
      const locked = { id: "u2", lockedAt: new Date() };
      prismaMock.user.update.mockResolvedValue(locked as never);

      const result = await caller.lockUser({ userId: "u2" });

      expect(result).toEqual(locked);
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "u2" },
          data: expect.objectContaining({ lockedBy: "user-1" }),
        }),
      );
    });

    it("throws BAD_REQUEST when locking yourself", async () => {
      await expect(caller.lockUser({ userId: "user-1" })).rejects.toThrow(
        "Cannot lock your own account",
      );
    });
  });

  // ─── unlockUser ───────────────────────────────────────────────────────────

  describe("unlockUser", () => {
    it("unlocks a user account", async () => {
      const unlocked = { id: "u2", lockedAt: null };
      prismaMock.user.update.mockResolvedValue(unlocked as never);

      const result = await caller.unlockUser({ userId: "u2" });

      expect(result).toEqual(unlocked);
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "u2" },
        data: { lockedAt: null, lockedBy: null },
        select: { id: true, lockedAt: true },
      });
    });
  });

  // ─── resetPassword ────────────────────────────────────────────────────────

  describe("resetPassword", () => {
    it("generates a temporary password for LOCAL user", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ authMethod: "LOCAL" } as never);
      prismaMock.user.update.mockResolvedValue({} as never);

      const result = await caller.resetPassword({ userId: "u2" });

      expect(result.temporaryPassword).toBeDefined();
      expect(typeof result.temporaryPassword).toBe("string");
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "u2" },
          data: expect.objectContaining({ mustChangePassword: true }),
        }),
      );
    });

    it("throws NOT_FOUND when user does not exist", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null as never);

      await expect(caller.resetPassword({ userId: "u-none" })).rejects.toThrow("User not found");
    });

    it("throws BAD_REQUEST for OIDC users", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ authMethod: "OIDC" } as never);

      await expect(caller.resetPassword({ userId: "u2" })).rejects.toThrow(
        "Cannot reset password for SSO users",
      );
    });
  });

  // ─── listTeams ────────────────────────────────────────────────────────────

  describe("listTeams", () => {
    it("returns teams excluding __system__ ordered by name", async () => {
      const teams = [
        { id: "t1", name: "Alpha" },
        { id: "t2", name: "Beta" },
      ];
      prismaMock.team.findMany.mockResolvedValue(teams as never);

      const result = await caller.listTeams();

      expect(result).toEqual(teams);
      expect(prismaMock.team.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: { not: "__system__" } },
          orderBy: { name: "asc" },
        }),
      );
    });
  });
});
