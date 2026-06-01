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

vi.mock("@/server/services/agent-token", () => ({
  generateEnrollmentToken: vi.fn(),
}));

vi.mock("@/server/services/crypto", () => ({
  ENCRYPTION_DOMAINS: { GENERIC: "generic" } as const,
  encrypt: vi.fn((val: string) => `encrypted:${val}`),
  decrypt: vi.fn((val: string) => val.replace("encrypted:", "")),
  encryptForOrg: vi.fn(async (val: string) => `v3:${val}`),
  decryptForOrg: vi.fn(async (val: string) => val.replace(/^v3:/, "")),
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
  organizationId: "org-1",
});

const editorCaller = t.createCallerFactory(environmentRouter)({
  session: { user: { id: "user-1", email: "editor@test.com" } },
  userRole: "EDITOR",
  teamId: "team-1",
  organizationId: "org-1",
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
    organizationId: "default",
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
    // Helper: wire the quota path so $transaction calls fn(prismaMock), the
    // org lookup returns the DEFAULT plan, a finite policy caps
    // environments at 1, and the env count stays below the limit before AND
    // after the create.
    async function arrangeQuotaPasses(opts: {
      organizationId: string;
      currentEnvCount: number;
    }) {
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
      );
      prismaMock.$executeRaw.mockResolvedValue(0 as never);
      prismaMock.organization.findUnique.mockResolvedValue({
        plan: "DEFAULT",
      } as never);
      // Install a finite policy for this test scope — finite-tier
      // policy mimicking the environments=1 limit.
      const { setQuotaPolicy } = await import("@/server/services/quotas");
      setQuotaPolicy({
        getPlanQuotas: () => ({ agents: 5, pipelines: 10, environments: 1 }),
      });
      // Pre-check, then post-check — both must be below environments=1.
      prismaMock.environment.count
        .mockResolvedValueOnce(opts.currentEnvCount)
        .mockResolvedValueOnce(opts.currentEnvCount + 1);
    }

    it("creates a new environment for an existing team", async () => {
      prismaMock.team.findUnique.mockResolvedValue({
        id: "team-1",
        organizationId: "org-1",
      } as never);
      // FREE plan allows 1 environment; we're at 0 -> create succeeds.
      await arrangeQuotaPasses({ organizationId: "org-1", currentEnvCount: 0 });
      prismaMock.environment.create.mockResolvedValue(
        makeEnvironment({ name: "Staging" }) as never,
      );

      const result = await editorCaller.create({ name: "Staging", teamId: "team-1" });

      expect(result.name).toBe("Staging");
      expect(prismaMock.environment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: "Staging", teamId: "team-1", organizationId: "org-1" },
        }),
      );
    });

    it("throws NOT_FOUND when team does not exist", async () => {
      prismaMock.team.findUnique.mockResolvedValue(null);

      await expect(
        editorCaller.create({ name: "Staging", teamId: "nonexistent" }),
      ).rejects.toThrow("Team not found");
    });

    it("rejects with PAYMENT_REQUIRED when the per-org environments quota is exhausted ", async () => {
      prismaMock.team.findUnique.mockResolvedValue({
        id: "team-1",
        organizationId: "org-1",
      } as never);
      // FREE plan limit is 1 environment; we're already at 1 -> reject.
      await arrangeQuotaPasses({ organizationId: "org-1", currentEnvCount: 1 });

      await expect(
        editorCaller.create({ name: "Staging", teamId: "team-1" }),
      ).rejects.toMatchObject({
        code: "PAYMENT_REQUIRED",
        message: expect.stringMatching(/Plan limit reached.*environments.*Upgrade/i),
      });
      expect(prismaMock.environment.create).not.toHaveBeenCalled();
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
      prismaMock.$transaction.mockImplementation(async (fn) =>
        (fn as (tx: unknown) => Promise<unknown>)(prismaMock),
      );

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
        identifier: "0123456789abcdef",
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
            enrollmentTokenId: "0123456789abcdef",
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

    it("looks up org slug for multi-tenant org and mints scoped token", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(
        makeEnvironment({ organizationId: "org-acme" }) as never,
      );
      prismaMock.organization.findUnique.mockResolvedValue(
        { id: "org-acme", slug: "acme" } as never,
      );
      vi.mocked(agentToken.generateEnrollmentToken).mockResolvedValue({
        token: "vfe_acme_abc123",
        hash: "hashed-acme",
        hint: "vfe_acme_abc...",
        identifier: "fedcba9876543210",
      });
      prismaMock.environment.update.mockResolvedValue({} as never);

      const result = await adminCaller.generateEnrollmentToken({ environmentId: "env-1" });

      expect(agentToken.generateEnrollmentToken).toHaveBeenCalledWith("acme");
      expect(result.token).toBe("vfe_acme_abc123");
      expect(result.hint).toBe("vfe_acme_abc...");
    });

    it("throws INTERNAL_SERVER_ERROR when multi-tenant org row is missing", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(
        makeEnvironment({ organizationId: "org-gone" }) as never,
      );
      prismaMock.organization.findUnique.mockResolvedValue(null);

      await expect(
        adminCaller.generateEnrollmentToken({ environmentId: "env-1" }),
      ).rejects.toThrow("Environment's organization not found");
    });

    it("throws INTERNAL_SERVER_ERROR when multi-tenant org is soft-deleted", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(
        makeEnvironment({ organizationId: "org-deleted" }) as never,
      );
      prismaMock.organization.findUnique.mockResolvedValue(
        { id: "org-deleted", slug: "deleted-org", deletedAt: new Date() } as never,
      );

      await expect(
        adminCaller.generateEnrollmentToken({ environmentId: "env-1" }),
      ).rejects.toThrow("Environment's organization not found or deleted");
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
            enrollmentTokenId: null,
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
