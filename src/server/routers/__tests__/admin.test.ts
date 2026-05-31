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
    it("returns users with memberships ordered by createdAt and projects isPlatformOperator from PlatformOperator emails", async () => {
      const users = [
        { id: "u1", email: "a@test.com", name: "A", memberships: [] },
        { id: "u2", email: "b@test.com", name: "B", memberships: [] },
      ];
      prismaMock.user.findMany.mockResolvedValue(users as never);
      prismaMock.platformOperator.findMany.mockResolvedValue([
        { email: "b@test.com" },
      ] as never);

      const result = await caller.listUsers();

      expect(result).toEqual([
        { id: "u1", email: "a@test.com", name: "A", memberships: [], isPlatformOperator: false },
        { id: "u2", email: "b@test.com", name: "B", memberships: [], isPlatformOperator: true },
      ]);
      expect(prismaMock.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: "asc" } }),
      );
      expect(prismaMock.platformOperator.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        select: { email: true },
      });
    });

    it("never selects isSuperAdmin from the User row (the column was dropped in slice 7c)", async () => {
      prismaMock.user.findMany.mockResolvedValue([] as never);
      prismaMock.platformOperator.findMany.mockResolvedValue([] as never);

      await caller.listUsers();

      const selectArg = (prismaMock.user.findMany.mock.calls[0]?.[0] as { select?: Record<string, unknown> })?.select;
      expect(selectArg).toBeDefined();
      expect(selectArg).not.toHaveProperty("isSuperAdmin");
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

  // ─── togglePlatformOperator ──────────────────────────────────────────────

  describe("togglePlatformOperator", () => {
    function mockUser(opts?: { id?: string; email?: string; name?: string | null }) {
      const row = {
        id: opts?.id ?? "u2",
        email: opts?.email ?? "u2@test.com",
        name: opts?.name === undefined ? "User Two" : opts.name,
      };
      prismaMock.user.findUnique.mockResolvedValue(row as never);
      return row;
    }

    it("returns the new operator status", async () => {
      mockUser();
      prismaMock.platformOperator.upsert.mockResolvedValue({} as never);

      const result = await caller.togglePlatformOperator({
        userId: "u2",
        isOperator: true,
      });

      expect(result).toEqual({ id: "u2", isPlatformOperator: true });
    });

    it("throws BAD_REQUEST when revoking your own operator status", async () => {
      await expect(
        caller.togglePlatformOperator({ userId: "user-1", isOperator: false }),
      ).rejects.toThrow("Cannot remove your own platform operator status");
    });

    it("allows granting operator to self (no-op but allowed)", async () => {
      mockUser({ id: "user-1", email: "admin@test.com", name: "Admin" });
      prismaMock.platformOperator.upsert.mockResolvedValue({} as never);

      const result = await caller.togglePlatformOperator({
        userId: "user-1",
        isOperator: true,
      });

      expect(result).toEqual({ id: "user-1", isPlatformOperator: true });
    });

    it("granting upserts PlatformOperator with INCIDENT role and clears deletedAt", async () => {
      mockUser();
      const upsert = prismaMock.platformOperator.upsert.mockResolvedValue({} as never);

      await caller.togglePlatformOperator({ userId: "u2", isOperator: true });

      expect(upsert).toHaveBeenCalledWith({
        where: { email: "u2@test.com" },
        create: { email: "u2@test.com", name: "User Two", role: "INCIDENT" },
        update: { deletedAt: null },
      });
      expect(prismaMock.platformOperator.updateMany).not.toHaveBeenCalled();
    });

    it("granting uses email as the operator name when User.name is null", async () => {
      mockUser({ id: "u3", email: "nameless@test.com", name: null });
      const upsert = prismaMock.platformOperator.upsert.mockResolvedValue({} as never);

      await caller.togglePlatformOperator({ userId: "u3", isOperator: true });

      expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({ name: "nameless@test.com" }),
      }));
    });

    it("revoking soft-deletes the operator row (no hard-delete, no User write)", async () => {
      mockUser();
      const updateMany = prismaMock.platformOperator.updateMany.mockResolvedValue({ count: 1 } as never);

      await caller.togglePlatformOperator({ userId: "u2", isOperator: false });

      expect(updateMany).toHaveBeenCalledWith({
        where: { email: "u2@test.com", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prismaMock.platformOperator.upsert).not.toHaveBeenCalled();
      // Confirm we never touched the User row — operator status no longer
      // lives on `User`.
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("refuses in strict multi-tenant mode (operators provisioned elsewhere)", async () => {
      const ORIG = process.env.VF_STRICT_MULTI_TENANT;
      process.env.VF_STRICT_MULTI_TENANT = "true";
      try {
        await expect(
          caller.togglePlatformOperator({ userId: "u2", isOperator: true }),
        ).rejects.toThrow(/strict multi-tenant/i);
        expect(prismaMock.platformOperator.upsert).not.toHaveBeenCalled();
        expect(prismaMock.platformOperator.updateMany).not.toHaveBeenCalled();
      } finally {
        if (ORIG === undefined) delete process.env.VF_STRICT_MULTI_TENANT;
        else process.env.VF_STRICT_MULTI_TENANT = ORIG;
      }
    });

    it("returns NOT_FOUND when the user does not exist", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null as never);

      await expect(
        caller.togglePlatformOperator({ userId: "ghost", isOperator: true }),
      ).rejects.toThrow("User not found");
      expect(prismaMock.platformOperator.upsert).not.toHaveBeenCalled();
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
