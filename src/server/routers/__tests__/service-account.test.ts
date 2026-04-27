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
    denyInDemo: passthrough,
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

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { serviceAccountRouter } from "@/server/routers/service-account";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(serviceAccountRouter)({
  session: { user: { id: "user-1", email: "admin@test.com" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("service-account router", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ─── list ──────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("returns service accounts for an environment", async () => {
      prismaMock.serviceAccount.findMany.mockResolvedValue([
        {
          id: "sa-1",
          name: "deploy-bot",
          description: "CI/CD",
          keyPrefix: "vf_live_abcd1234",
          environmentId: "env-1",
          permissions: ["pipelines.read", "pipelines.deploy"],
          lastUsedAt: null,
          expiresAt: null,
          enabled: true,
          createdAt: new Date(),
          createdBy: { name: "Admin", email: "admin@test.com" },
        },
      ] as never);

      const result = await caller.list({ environmentId: "env-1" });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("deploy-bot");
      // Verify hashedKey is NOT in the select
      expect(prismaMock.serviceAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.not.objectContaining({ hashedKey: true }),
        }),
      );
    });
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("creates a service account and returns the raw key", async () => {
      prismaMock.serviceAccount.findFirst.mockResolvedValue(null);
      prismaMock.serviceAccount.create.mockResolvedValue({
        id: "sa-new",
        name: "new-bot",
        keyPrefix: "vf_live_12345678",
        permissions: ["pipelines.read"],
        expiresAt: null,
        createdAt: new Date(),
      } as never);

      const result = await caller.create({
        environmentId: "env-1",
        name: "new-bot",
        permissions: ["pipelines.read"],
      });

      expect(result.name).toBe("new-bot");
      expect(result.rawKey).toBeDefined();
      expect(result.rawKey).toMatch(/^vf_live_/);
    });

    it("creates a service account with expiration", async () => {
      prismaMock.serviceAccount.findFirst.mockResolvedValue(null);
      prismaMock.serviceAccount.create.mockResolvedValue({
        id: "sa-new",
        name: "temp-bot",
        keyPrefix: "vf_live_12345678",
        permissions: ["pipelines.read"],
        expiresAt: new Date("2026-04-30"),
        createdAt: new Date(),
      } as never);

      const result = await caller.create({
        environmentId: "env-1",
        name: "temp-bot",
        permissions: ["pipelines.read"],
        expiresInDays: 30,
      });

      expect(result.rawKey).toBeDefined();
      expect(prismaMock.serviceAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            expiresAt: expect.any(Date),
          }),
        }),
      );
    });

    it("rejects duplicate names within an environment", async () => {
      prismaMock.serviceAccount.findFirst.mockResolvedValue({
        id: "sa-existing",
      } as never);

      await expect(
        caller.create({
          environmentId: "env-1",
          name: "deploy-bot",
          permissions: ["pipelines.read"],
        }),
      ).rejects.toThrow("service account with this name already exists");
    });
  });

  // ─── revoke ────────────────────────────────────────────────────────────────

  describe("revoke", () => {
    it("disables a service account", async () => {
      prismaMock.serviceAccount.findUnique.mockResolvedValue({
        id: "sa-1",
        enabled: true,
      } as never);
      prismaMock.serviceAccount.update.mockResolvedValue({
        id: "sa-1",
        name: "deploy-bot",
        enabled: false,
      } as never);

      const result = await caller.revoke({ id: "sa-1" });

      expect(result.enabled).toBe(false);
    });

    it("throws NOT_FOUND when service account does not exist", async () => {
      prismaMock.serviceAccount.findUnique.mockResolvedValue(null);

      await expect(
        caller.revoke({ id: "nonexistent" }),
      ).rejects.toThrow("Service account not found");
    });
  });

  // ─── delete ────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes a service account", async () => {
      prismaMock.serviceAccount.findUnique.mockResolvedValue({
        id: "sa-1",
      } as never);
      prismaMock.serviceAccount.delete.mockResolvedValue({} as never);

      const result = await caller.delete({ id: "sa-1" });

      expect(result.deleted).toBe(true);
    });

    it("throws NOT_FOUND when service account does not exist", async () => {
      prismaMock.serviceAccount.findUnique.mockResolvedValue(null);

      await expect(
        caller.delete({ id: "nonexistent" }),
      ).rejects.toThrow("Service account not found");
    });
  });
});
