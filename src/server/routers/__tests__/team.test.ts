import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── vi.hoisted so `t` is available inside vi.mock factories ────────────────

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

vi.mock("@/server/services/crypto", () => ({
  encrypt: vi.fn((val: string) => `enc:${val}`),
}));

vi.mock("@/server/services/ai", () => ({
  testAiConnection: vi.fn(),
}));

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed-password") },
}));

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { teamRouter, assertManualAssignmentAllowed } from "@/server/routers/team";
import * as aiService from "@/server/services/ai";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const adminCaller = t.createCallerFactory(teamRouter)({
  session: { user: { id: "user-1", email: "admin@test.com", name: "Admin" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- available for viewer-permission tests
const viewerCaller = t.createCallerFactory(teamRouter)({
  session: { user: { id: "user-1", email: "viewer@test.com", name: "Viewer" } },
  userRole: "VIEWER",
  teamId: "team-1",
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("team router", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ─── assertManualAssignmentAllowed ────────────────────────────────────────

  describe("assertManualAssignmentAllowed", () => {
    it("allows LOCAL user", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ authMethod: "LOCAL" } as never);

      await expect(assertManualAssignmentAllowed("user-1")).resolves.toBeUndefined();
    });

    it("allows OIDC user when neither SCIM nor group sync is enabled", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ authMethod: "OIDC" } as never);
      prismaMock.systemSettings.findUnique.mockResolvedValue({
        scimEnabled: false,
        oidcGroupSyncEnabled: false,
      } as never);

      await expect(assertManualAssignmentAllowed("user-1")).resolves.toBeUndefined();
    });

    it("blocks OIDC user when SCIM is enabled", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ authMethod: "OIDC" } as never);
      prismaMock.systemSettings.findUnique.mockResolvedValue({
        scimEnabled: true,
        oidcGroupSyncEnabled: false,
      } as never);

      await expect(assertManualAssignmentAllowed("user-1")).rejects.toThrow(
        "managed by your identity provider",
      );
    });

    it("blocks OIDC user when group sync is enabled", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ authMethod: "OIDC" } as never);
      prismaMock.systemSettings.findUnique.mockResolvedValue({
        scimEnabled: false,
        oidcGroupSyncEnabled: true,
      } as never);

      await expect(assertManualAssignmentAllowed("user-1")).rejects.toThrow(
        "managed by your identity provider",
      );
    });

    it("blocks OIDC user when both SCIM and group sync are enabled", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ authMethod: "OIDC" } as never);
      prismaMock.systemSettings.findUnique.mockResolvedValue({
        scimEnabled: true,
        oidcGroupSyncEnabled: true,
      } as never);

      await expect(assertManualAssignmentAllowed("user-1")).rejects.toThrow(
        "managed by your identity provider",
      );
    });

    it("throws NOT_FOUND when user does not exist", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(assertManualAssignmentAllowed("nonexistent")).rejects.toThrow(
        "User not found",
      );
    });
  });

  // ─── myRole ────────────────────────────────────────────────────────────────

  describe("myRole", () => {
    it("returns the highest role across all teams", async () => {
      prismaMock.teamMember.findMany.mockResolvedValue([
        { role: "VIEWER" },
        { role: "ADMIN" },
        { role: "EDITOR" },
      ] as never);

      const result = await adminCaller.myRole();

      expect(result.role).toBe("ADMIN");
    });

    it("returns VIEWER when user has no team memberships", async () => {
      prismaMock.teamMember.findMany.mockResolvedValue([] as never);

      const result = await adminCaller.myRole();

      expect(result.role).toBe("VIEWER");
    });
  });

  // ─── teamRole ─────────────────────────────────────────────────────────────

  describe("teamRole", () => {
    it("returns ADMIN with isSuperAdmin true for super admins", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as never);

      const result = await adminCaller.teamRole({ teamId: "team-1" });

      expect(result.role).toBe("ADMIN");
      expect(result.isSuperAdmin).toBe(true);
    });

    it("returns the membership role for regular users", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: false } as never);
      prismaMock.teamMember.findUnique.mockResolvedValue({ role: "EDITOR" } as never);

      const result = await adminCaller.teamRole({ teamId: "team-1" });

      expect(result.role).toBe("EDITOR");
      expect(result.isSuperAdmin).toBe(false);
    });

    it("defaults to VIEWER when user has no membership", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: false } as never);
      prismaMock.teamMember.findUnique.mockResolvedValue(null);

      const result = await adminCaller.teamRole({ teamId: "team-1" });

      expect(result.role).toBe("VIEWER");
    });
  });

  // ─── list ─────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("strips aiApiKey from returned teams", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: false } as never);
      prismaMock.team.findMany.mockResolvedValue([
        {
          id: "team-1",
          name: "My Team",
          aiApiKey: "enc:secret",
          _count: { members: 2, environments: 1 },
        },
      ] as never);

      const result = await adminCaller.list();

      expect(result).toHaveLength(1);
      expect((result[0] as Record<string, unknown>).aiApiKey).toBeUndefined();
    });
  });

  // ─── get ───────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("returns team details without aiApiKey", async () => {
      prismaMock.team.findUnique.mockResolvedValue({
        id: "team-1",
        name: "My Team",
        aiApiKey: "enc:secret",
        members: [],
        _count: { environments: 2 },
      } as never);

      const result = await adminCaller.get({ id: "team-1" });

      expect(result.id).toBe("team-1");
      expect((result as Record<string, unknown>).aiApiKey).toBeUndefined();
    });

    it("throws NOT_FOUND when team does not exist", async () => {
      prismaMock.team.findUnique.mockResolvedValue(null);

      await expect(
        adminCaller.get({ id: "nonexistent" }),
      ).rejects.toThrow("Team not found");
    });
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("creates a team with the current user as ADMIN member", async () => {
      prismaMock.team.create.mockResolvedValue({
        id: "team-new",
        name: "New Team",
        members: [{ userId: "user-1", role: "ADMIN" }],
      } as never);

      const result = await adminCaller.create({ name: "New Team" });

      expect(result.name).toBe("New Team");
      expect(prismaMock.team.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "New Team",
            members: { create: { userId: "user-1", role: "ADMIN" } },
          }),
        }),
      );
    });
  });

  // ─── delete ────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes a team with no environments", async () => {
      prismaMock.team.findUnique.mockResolvedValue({
        id: "team-1",
        environments: [],
      } as never);
      prismaMock.team.count.mockResolvedValue(2);
      prismaMock.$transaction.mockResolvedValue([{}, {}, {}, {}] as never);

      const result = await adminCaller.delete({ teamId: "team-1" });

      expect(result.deleted).toBe(true);
    });

    it("throws PRECONDITION_FAILED when team has environments", async () => {
      prismaMock.team.findUnique.mockResolvedValue({
        id: "team-1",
        environments: [{ name: "Dev" }, { name: "Prod" }],
      } as never);

      await expect(
        adminCaller.delete({ teamId: "team-1" }),
      ).rejects.toThrow("Cannot delete team with environments");
    });

    it("throws BAD_REQUEST when trying to delete the last team", async () => {
      prismaMock.team.findUnique.mockResolvedValue({
        id: "team-1",
        environments: [],
      } as never);
      prismaMock.team.count.mockResolvedValue(1);

      await expect(
        adminCaller.delete({ teamId: "team-1" }),
      ).rejects.toThrow("Cannot delete the last remaining team");
    });

    it("throws NOT_FOUND when team does not exist", async () => {
      prismaMock.team.findUnique.mockResolvedValue(null);

      await expect(
        adminCaller.delete({ teamId: "nonexistent" }),
      ).rejects.toThrow("Team not found");
    });
  });

  // ─── addMember ────────────────────────────────────────────────────────────

  describe("addMember", () => {
    it("adds a user to the team by email", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: "user-2",
        authMethod: "LOCAL",
      } as never);
      prismaMock.systemSettings.findUnique.mockResolvedValue(null);
      prismaMock.teamMember.findUnique.mockResolvedValue(null);
      prismaMock.teamMember.create.mockResolvedValue({
        id: "member-1",
        teamId: "team-1",
        userId: "user-2",
        role: "EDITOR",
        user: { id: "user-2", name: "Bob", email: "bob@test.com" },
      } as never);

      const result = await adminCaller.addMember({
        teamId: "team-1",
        email: "bob@test.com",
        role: "EDITOR",
      });

      expect(result.userId).toBe("user-2");
    });

    it("throws NOT_FOUND when user email does not exist", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(
        adminCaller.addMember({
          teamId: "team-1",
          email: "nobody@test.com",
          role: "VIEWER",
        }),
      ).rejects.toThrow("No user found with email");
    });

    it("throws CONFLICT when user is already a member", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: "user-2",
        authMethod: "LOCAL",
      } as never);
      prismaMock.systemSettings.findUnique.mockResolvedValue(null);
      prismaMock.teamMember.findUnique.mockResolvedValue({ id: "existing" } as never);

      await expect(
        adminCaller.addMember({
          teamId: "team-1",
          email: "bob@test.com",
          role: "EDITOR",
        }),
      ).rejects.toThrow("already a member");
    });

    it("blocks adding OIDC user when SCIM is enabled", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: "user-oidc",
        authMethod: "OIDC",
      } as never);
      prismaMock.systemSettings.findUnique.mockResolvedValue({
        scimEnabled: true,
        oidcGroupSyncEnabled: false,
      } as never);

      await expect(
        adminCaller.addMember({
          teamId: "team-1",
          email: "oidc@test.com",
          role: "VIEWER",
        }),
      ).rejects.toThrow("managed by your identity provider");
    });
  });

  // ─── removeMember ─────────────────────────────────────────────────────────

  describe("removeMember", () => {
    it("removes a team member", async () => {
      prismaMock.teamMember.findUnique.mockResolvedValue({
        id: "member-1",
      } as never);
      prismaMock.teamMember.delete.mockResolvedValue({} as never);

      const result = await adminCaller.removeMember({
        teamId: "team-1",
        userId: "user-2",
      });

      expect(result.removed).toBe(true);
    });

    it("throws BAD_REQUEST when trying to remove yourself", async () => {
      await expect(
        adminCaller.removeMember({
          teamId: "team-1",
          userId: "user-1",
        }),
      ).rejects.toThrow("Cannot remove yourself");
    });

    it("throws NOT_FOUND when member does not exist", async () => {
      prismaMock.teamMember.findUnique.mockResolvedValue(null);

      await expect(
        adminCaller.removeMember({
          teamId: "team-1",
          userId: "nonexistent",
        }),
      ).rejects.toThrow("Team member not found");
    });
  });

  // ─── updateMemberRole ─────────────────────────────────────────────────────

  describe("updateMemberRole", () => {
    it("updates member role", async () => {
      prismaMock.teamMember.findUnique.mockResolvedValue({ id: "member-1" } as never);
      // For assertManualAssignmentAllowed
      prismaMock.user.findUnique.mockResolvedValue({ authMethod: "LOCAL" } as never);
      prismaMock.teamMember.update.mockResolvedValue({
        id: "member-1",
        role: "ADMIN",
        user: { id: "user-2", name: "Bob", email: "bob@test.com" },
      } as never);

      const result = await adminCaller.updateMemberRole({
        teamId: "team-1",
        userId: "user-2",
        role: "ADMIN",
      });

      expect(result.role).toBe("ADMIN");
    });

    it("throws NOT_FOUND when member does not exist", async () => {
      prismaMock.teamMember.findUnique.mockResolvedValue(null);

      await expect(
        adminCaller.updateMemberRole({
          teamId: "team-1",
          userId: "nonexistent",
          role: "EDITOR",
        }),
      ).rejects.toThrow("Team member not found");
    });

    it("blocks role update for OIDC user when group sync is enabled", async () => {
      prismaMock.teamMember.findUnique.mockResolvedValue({ id: "member-1" } as never);
      prismaMock.user.findUnique.mockResolvedValue({ authMethod: "OIDC" } as never);
      prismaMock.systemSettings.findUnique.mockResolvedValue({
        scimEnabled: false,
        oidcGroupSyncEnabled: true,
      } as never);

      await expect(
        adminCaller.updateMemberRole({
          teamId: "team-1",
          userId: "user-oidc",
          role: "ADMIN",
        }),
      ).rejects.toThrow("managed by your identity provider");
    });
  });

  // ─── lockMember ───────────────────────────────────────────────────────────

  describe("lockMember", () => {
    it("locks a team member account", async () => {
      prismaMock.teamMember.findUnique.mockResolvedValue({ id: "member-1" } as never);
      prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: false } as never);
      prismaMock.user.update.mockResolvedValue({
        id: "user-2",
        lockedAt: new Date(),
      } as never);

      const result = await adminCaller.lockMember({
        teamId: "team-1",
        userId: "user-2",
      });

      expect(result.lockedAt).toBeDefined();
    });

    it("throws BAD_REQUEST when trying to lock yourself", async () => {
      await expect(
        adminCaller.lockMember({ teamId: "team-1", userId: "user-1" }),
      ).rejects.toThrow("Cannot lock your own account");
    });

    it("throws FORBIDDEN when trying to lock a super admin", async () => {
      prismaMock.teamMember.findUnique.mockResolvedValue({ id: "member-1" } as never);
      prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as never);

      await expect(
        adminCaller.lockMember({ teamId: "team-1", userId: "user-sa" }),
      ).rejects.toThrow("Cannot lock a super admin");
    });
  });

  // ─── unlockMember ─────────────────────────────────────────────────────────

  describe("unlockMember", () => {
    it("unlocks a team member account", async () => {
      prismaMock.teamMember.findUnique.mockResolvedValue({ id: "member-1" } as never);
      prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: false } as never);
      prismaMock.user.update.mockResolvedValue({
        id: "user-2",
        lockedAt: null,
      } as never);

      const result = await adminCaller.unlockMember({
        teamId: "team-1",
        userId: "user-2",
      });

      expect(result.lockedAt).toBeNull();
    });

    it("throws FORBIDDEN when trying to unlock a super admin", async () => {
      prismaMock.teamMember.findUnique.mockResolvedValue({ id: "member-1" } as never);
      prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as never);

      await expect(
        adminCaller.unlockMember({ teamId: "team-1", userId: "user-sa" }),
      ).rejects.toThrow("Cannot modify a super admin");
    });
  });

  // ─── resetMemberPassword ──────────────────────────────────────────────────

  describe("resetMemberPassword", () => {
    it("resets password and returns temporary password", async () => {
      prismaMock.teamMember.findUnique.mockResolvedValue({
        id: "member-1",
        user: { authMethod: "LOCAL", isSuperAdmin: false },
      } as never);
      prismaMock.user.update.mockResolvedValue({} as never);

      const result = await adminCaller.resetMemberPassword({
        teamId: "team-1",
        userId: "user-2",
      });

      expect(result.temporaryPassword).toBeDefined();
      expect(typeof result.temporaryPassword).toBe("string");
    });

    it("throws FORBIDDEN when trying to reset super admin password", async () => {
      prismaMock.teamMember.findUnique.mockResolvedValue({
        id: "member-1",
        user: { authMethod: "LOCAL", isSuperAdmin: true },
      } as never);

      await expect(
        adminCaller.resetMemberPassword({ teamId: "team-1", userId: "user-sa" }),
      ).rejects.toThrow("Cannot reset a super admin password");
    });

    it("throws BAD_REQUEST when trying to reset SSO user password", async () => {
      prismaMock.teamMember.findUnique.mockResolvedValue({
        id: "member-1",
        user: { authMethod: "OIDC", isSuperAdmin: false },
      } as never);

      await expect(
        adminCaller.resetMemberPassword({ teamId: "team-1", userId: "user-oidc" }),
      ).rejects.toThrow("Cannot reset password for SSO-only users");
    });
  });

  // ─── rename ────────────────────────────────────────────────────────────────

  describe("rename", () => {
    it("renames a team", async () => {
      prismaMock.team.findUnique.mockResolvedValue({ id: "team-1" } as never);
      prismaMock.team.update.mockResolvedValue({
        id: "team-1",
        name: "Renamed Team",
      } as never);

      const result = await adminCaller.rename({ teamId: "team-1", name: "Renamed Team" });

      expect(result.name).toBe("Renamed Team");
    });

    it("throws NOT_FOUND when team does not exist", async () => {
      prismaMock.team.findUnique.mockResolvedValue(null);

      await expect(
        adminCaller.rename({ teamId: "nonexistent", name: "Nope" }),
      ).rejects.toThrow("Team not found");
    });
  });

  // ─── testAiConnection ─────────────────────────────────────────────────────

  describe("testAiConnection", () => {
    it("delegates to AI service", async () => {
      vi.mocked(aiService.testAiConnection).mockResolvedValue({
        success: true,
        latencyMs: 150,
      } as never);

      const result = await adminCaller.testAiConnection({ teamId: "team-1" });

      expect(result.success).toBe(true);
      expect(aiService.testAiConnection).toHaveBeenCalledWith("team-1");
    });
  });

  // ─── updateAiConfig ───────────────────────────────────────────────────────

  describe("updateAiConfig", () => {
    it("encrypts AI API key when provided", async () => {
      prismaMock.team.update.mockResolvedValue({
        id: "team-1",
        aiEnabled: true,
        aiProvider: "openai",
        aiBaseUrl: null,
        aiModel: "gpt-4",
      } as never);

      await adminCaller.updateAiConfig({
        teamId: "team-1",
        aiEnabled: true,
        aiApiKey: "sk-test-key",
      });

      expect(prismaMock.team.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            aiApiKey: "enc:enc:sk-test-key",
          }),
        }),
      );
    });

    it("clears AI API key when null is passed", async () => {
      prismaMock.team.update.mockResolvedValue({
        id: "team-1",
        aiEnabled: false,
        aiProvider: null,
        aiBaseUrl: null,
        aiModel: null,
      } as never);

      await adminCaller.updateAiConfig({
        teamId: "team-1",
        aiApiKey: null,
      });

      expect(prismaMock.team.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            aiApiKey: null,
          }),
        }),
      );
    });
  });
});
