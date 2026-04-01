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

vi.mock("@/server/services/agent-token", () => ({
  generateEnrollmentToken: vi.fn(),
}));

vi.mock("@/server/services/crypto", () => ({
  encrypt: vi.fn((val: string) => `encrypted:${val}`),
  decrypt: vi.fn((val: string) => val.replace("encrypted:", "")),
}));

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { environmentRouter } from "@/server/routers/environment";
import * as agentToken from "@/server/services/agent-token";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const adminCaller = t.createCallerFactory(environmentRouter)({
  session: { user: { id: "user-1", email: "admin@test.com" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

const editorCaller = t.createCallerFactory(environmentRouter)({
  session: { user: { id: "user-1", email: "editor@test.com" } },
  userRole: "EDITOR",
  teamId: "team-1",
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeEnvironment(overrides: Record<string, unknown> = {}) {
  return {
    id: "env-1",
    name: "Development",
    teamId: "team-1",
    isSystem: false,
    gitToken: null,
    enrollmentTokenHash: null,
    enrollmentTokenHint: null,
    gitWebhookSecret: null,
    gitOpsMode: "off",
    gitRepoUrl: null,
    gitBranch: null,
    gitProvider: null,
    requireDeployApproval: false,
    costPerGbCents: 0,
    costBudgetCents: null,
    secretBackend: "BUILTIN",
    secretBackendConfig: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    nodes: [],
    _count: { nodes: 0, pipelines: 0 },
    team: { id: "team-1", name: "Test Team" },
    pipelines: [],
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("environment router", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ─── list ──────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("returns non-system environments for a team", async () => {
      prismaMock.environment.findMany.mockResolvedValue([
        makeEnvironment(),
      ] as never);

      const result = await adminCaller.list({ teamId: "team-1" });

      expect(result).toHaveLength(1);
      expect(prismaMock.environment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { teamId: "team-1", isSystem: false },
        }),
      );
    });
  });

  // ─── getSystem ────────────────────────────────────────────────────────────

  describe("getSystem", () => {
    it("returns the system environment", async () => {
      prismaMock.environment.findFirst.mockResolvedValue({
        id: "sys-env",
        name: "__system__",
        isSystem: true,
      } as never);

      const result = await adminCaller.getSystem();

      expect(result?.id).toBe("sys-env");
      expect(result?.isSystem).toBe(true);
    });

    it("returns null when no system environment exists", async () => {
      prismaMock.environment.findFirst.mockResolvedValue(null);

      const result = await adminCaller.getSystem();

      expect(result).toBeNull();
    });
  });

  // ─── get ───────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("returns environment without sensitive fields", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(
        makeEnvironment({
          gitToken: "encrypted:secret-token",
          enrollmentTokenHash: "some-hash",
          gitWebhookSecret: "encrypted:webhook-secret",
        }) as never,
      );

      const result = await adminCaller.get({ id: "env-1" });

      expect(result.id).toBe("env-1");
      expect(result.hasEnrollmentToken).toBe(true);
      expect(result.hasGitToken).toBe(true);
      expect(result.hasWebhookSecret).toBe(true);
      // Ensure raw secrets are NOT returned
      expect((result as Record<string, unknown>).gitToken).toBeUndefined();
      expect((result as Record<string, unknown>).enrollmentTokenHash).toBeUndefined();
    });

    it("throws NOT_FOUND when environment does not exist", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(null);

      await expect(
        adminCaller.get({ id: "nonexistent" }),
      ).rejects.toThrow("Environment not found");
    });
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("creates a new environment for an existing team", async () => {
      prismaMock.team.findUnique.mockResolvedValue({ id: "team-1" } as never);
      prismaMock.environment.create.mockResolvedValue(
        makeEnvironment({ name: "Staging" }) as never,
      );

      const result = await editorCaller.create({ name: "Staging", teamId: "team-1" });

      expect(result.name).toBe("Staging");
      expect(prismaMock.environment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: "Staging", teamId: "team-1" },
        }),
      );
    });

    it("throws NOT_FOUND when team does not exist", async () => {
      prismaMock.team.findUnique.mockResolvedValue(null);

      await expect(
        editorCaller.create({ name: "Staging", teamId: "nonexistent" }),
      ).rejects.toThrow("Team not found");
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────

  describe("update", () => {
    it("updates environment name", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment() as never);
      prismaMock.environment.update.mockResolvedValue(
        makeEnvironment({ name: "Production" }) as never,
      );

      const result = await adminCaller.update({ id: "env-1", name: "Production" });

      expect(result.name).toBe("Production");
    });

    it("encrypts git token when provided", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment() as never);
      prismaMock.environment.update.mockResolvedValue(makeEnvironment() as never);

      await adminCaller.update({ id: "env-1", gitToken: "my-secret-token" });

      expect(prismaMock.environment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            gitToken: "encrypted:my-secret-token",
          }),
        }),
      );
    });

    it("throws FORBIDDEN when EDITOR tries to change deploy approval requirement", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment() as never);

      await expect(
        editorCaller.update({ id: "env-1", requireDeployApproval: true }),
      ).rejects.toThrow("Only admins can change the deploy approval requirement");
    });

    it("throws NOT_FOUND when environment does not exist", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(null);

      await expect(
        adminCaller.update({ id: "nonexistent", name: "New Name" }),
      ).rejects.toThrow("Environment not found");
    });

    it("throws FORBIDDEN when trying to modify system environment", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(
        makeEnvironment({ isSystem: true }) as never,
      );

      await expect(
        adminCaller.update({ id: "env-sys", name: "Hacked" }),
      ).rejects.toThrow("system environment cannot be modified");
    });
  });

  // ─── delete ────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes environment and cleans up related resources", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(
        makeEnvironment({ pipelines: [{ id: "p-1" }, { id: "p-2" }] }) as never,
      );
      prismaMock.$transaction.mockResolvedValue([{}, {}, {}, {}] as never);

      await adminCaller.delete({ id: "env-1" });

      expect(prismaMock.$transaction).toHaveBeenCalled();
    });

    it("throws NOT_FOUND when environment does not exist", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(null);

      await expect(
        adminCaller.delete({ id: "nonexistent" }),
      ).rejects.toThrow("Environment not found");
    });

    it("throws FORBIDDEN when trying to delete system environment", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(
        makeEnvironment({ isSystem: true }) as never,
      );

      await expect(
        adminCaller.delete({ id: "env-sys" }),
      ).rejects.toThrow("system environment cannot be deleted");
    });
  });

  // ─── generateEnrollmentToken ──────────────────────────────────────────────

  describe("generateEnrollmentToken", () => {
    it("generates and stores enrollment token", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment() as never);
      vi.mocked(agentToken.generateEnrollmentToken).mockResolvedValue({
        token: "vfe_abc123",
        hash: "hashed-token",
        hint: "vfe_abc...",
      });
      prismaMock.environment.update.mockResolvedValue({} as never);

      const result = await adminCaller.generateEnrollmentToken({ environmentId: "env-1" });

      expect(result.token).toBe("vfe_abc123");
      expect(result.hint).toBe("vfe_abc...");
      expect(prismaMock.environment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            enrollmentTokenHash: "hashed-token",
            enrollmentTokenHint: "vfe_abc...",
          },
        }),
      );
    });

    it("throws NOT_FOUND when environment does not exist", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(null);

      await expect(
        adminCaller.generateEnrollmentToken({ environmentId: "nonexistent" }),
      ).rejects.toThrow("Environment not found");
    });
  });

  // ─── revokeEnrollmentToken ────────────────────────────────────────────────

  describe("revokeEnrollmentToken", () => {
    it("clears enrollment token hash and hint", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment() as never);
      prismaMock.environment.update.mockResolvedValue({} as never);

      const result = await adminCaller.revokeEnrollmentToken({ environmentId: "env-1" });

      expect(result.success).toBe(true);
      expect(prismaMock.environment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            enrollmentTokenHash: null,
            enrollmentTokenHint: null,
          },
        }),
      );
    });

    it("throws NOT_FOUND when environment does not exist", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(null);

      await expect(
        adminCaller.revokeEnrollmentToken({ environmentId: "nonexistent" }),
      ).rejects.toThrow("Environment not found");
    });
  });
});
