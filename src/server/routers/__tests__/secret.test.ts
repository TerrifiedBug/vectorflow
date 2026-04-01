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
  encrypt: vi.fn((val: string) => `encrypted:${val}`),
  decrypt: vi.fn((val: string) => val.replace("encrypted:", "")),
}));

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { secretRouter } from "@/server/routers/secret";
import * as crypto from "@/server/services/crypto";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(secretRouter)({
  session: { user: { id: "user-1", email: "test@test.com" } },
  userRole: "EDITOR",
  teamId: "team-1",
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("secret router", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ─── list ──────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("returns secrets without encrypted values", async () => {
      prismaMock.secret.findMany.mockResolvedValue([
        { id: "s-1", name: "API_KEY", createdAt: new Date(), updatedAt: new Date() },
        { id: "s-2", name: "DB_PASSWORD", createdAt: new Date(), updatedAt: new Date() },
      ] as never);

      const result = await caller.list({ environmentId: "env-1" });

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("API_KEY");
      // Verify encryptedValue is NOT in the select
      expect(prismaMock.secret.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            id: true,
            name: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      );
    });
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("creates a secret with encrypted value", async () => {
      prismaMock.secret.findUnique.mockResolvedValue(null);
      prismaMock.secret.create.mockResolvedValue({
        id: "s-new",
        name: "MY_SECRET",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      const result = await caller.create({
        environmentId: "env-1",
        name: "MY_SECRET",
        value: "super-secret-value",
      });

      expect(result.name).toBe("MY_SECRET");
      expect(crypto.encrypt).toHaveBeenCalledWith("super-secret-value");
      expect(prismaMock.secret.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "MY_SECRET",
            encryptedValue: "encrypted:super-secret-value",
            environmentId: "env-1",
          }),
        }),
      );
    });

    it("rejects duplicate secret names within an environment", async () => {
      prismaMock.secret.findUnique.mockResolvedValue({
        id: "s-existing",
        name: "DUPLICATE",
      } as never);

      await expect(
        caller.create({
          environmentId: "env-1",
          name: "DUPLICATE",
          value: "some-value",
        }),
      ).rejects.toThrow("secret with this name already exists");
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────

  describe("update", () => {
    it("updates the encrypted value of an existing secret", async () => {
      prismaMock.secret.findUnique.mockResolvedValue({
        id: "s-1",
        environmentId: "env-1",
      } as never);
      prismaMock.secret.update.mockResolvedValue({
        id: "s-1",
        name: "API_KEY",
        updatedAt: new Date(),
      } as never);

      const result = await caller.update({
        id: "s-1",
        environmentId: "env-1",
        value: "new-secret-value",
      });

      expect(result.name).toBe("API_KEY");
      expect(crypto.encrypt).toHaveBeenCalledWith("new-secret-value");
    });

    it("throws NOT_FOUND when secret does not exist", async () => {
      prismaMock.secret.findUnique.mockResolvedValue(null);

      await expect(
        caller.update({
          id: "nonexistent",
          environmentId: "env-1",
          value: "new-value",
        }),
      ).rejects.toThrow("Secret not found");
    });

    it("throws NOT_FOUND when secret belongs to different environment", async () => {
      prismaMock.secret.findUnique.mockResolvedValue({
        id: "s-1",
        environmentId: "env-2",
      } as never);

      await expect(
        caller.update({
          id: "s-1",
          environmentId: "env-1",
          value: "new-value",
        }),
      ).rejects.toThrow("Secret not found");
    });
  });

  // ─── delete ────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes a secret", async () => {
      prismaMock.secret.findUnique.mockResolvedValue({
        id: "s-1",
        environmentId: "env-1",
      } as never);
      prismaMock.secret.delete.mockResolvedValue({} as never);

      const result = await caller.delete({ id: "s-1", environmentId: "env-1" });

      expect(result.deleted).toBe(true);
    });

    it("throws NOT_FOUND when secret does not exist", async () => {
      prismaMock.secret.findUnique.mockResolvedValue(null);

      await expect(
        caller.delete({ id: "nonexistent", environmentId: "env-1" }),
      ).rejects.toThrow("Secret not found");
    });

    it("throws NOT_FOUND when secret belongs to different environment", async () => {
      prismaMock.secret.findUnique.mockResolvedValue({
        id: "s-1",
        environmentId: "env-2",
      } as never);

      await expect(
        caller.delete({ id: "s-1", environmentId: "env-1" }),
      ).rejects.toThrow("Secret not found");
    });
  });

  // ─── resolve ──────────────────────────────────────────────────────────────

  describe("resolve", () => {
    it("decrypts and returns the secret value", async () => {
      prismaMock.secret.findUnique.mockResolvedValue({
        encryptedValue: "encrypted:my-actual-secret",
      } as never);

      const result = await caller.resolve({
        environmentId: "env-1",
        name: "API_KEY",
      });

      expect(result.value).toBe("my-actual-secret");
      expect(crypto.decrypt).toHaveBeenCalledWith("encrypted:my-actual-secret");
    });

    it("throws NOT_FOUND when secret does not exist", async () => {
      prismaMock.secret.findUnique.mockResolvedValue(null);

      await expect(
        caller.resolve({ environmentId: "env-1", name: "MISSING" }),
      ).rejects.toThrow('Secret "MISSING" not found');
    });
  });
});
