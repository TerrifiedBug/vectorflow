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

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { userPreferenceRouter } from "@/server/routers/user-preference";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const caller = t.createCallerFactory(userPreferenceRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("userPreferenceRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ─── get ──────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("returns preferences as key-value map", async () => {
      prismaMock.userPreference.findMany.mockResolvedValue([
        { id: "p1", userId: "user-1", key: "theme", value: "dark" },
        { id: "p2", userId: "user-1", key: "lang", value: "en" },
      ] as never);

      const result = await caller.get();

      expect(result).toEqual({ theme: "dark", lang: "en" });
    });

    it("returns empty object when no preferences exist", async () => {
      prismaMock.userPreference.findMany.mockResolvedValue([] as never);

      const result = await caller.get();

      expect(result).toEqual({});
    });
  });

  // ─── set ──────────────────────────────────────────────────────────────────

  describe("set", () => {
    it("upserts a preference with composite key", async () => {
      prismaMock.userPreference.upsert.mockResolvedValue({} as never);

      await caller.set({ key: "theme", value: "light" });

      expect(prismaMock.userPreference.upsert).toHaveBeenCalledWith({
        where: {
          userId_key: { userId: "user-1", key: "theme" },
        },
        create: { userId: "user-1", key: "theme", value: "light" },
        update: { value: "light" },
      });
    });
  });

  // ─── delete ───────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes a preference by key", async () => {
      prismaMock.userPreference.deleteMany.mockResolvedValue({ count: 1 } as never);

      await caller.delete({ key: "theme" });

      expect(prismaMock.userPreference.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user-1", key: "theme" },
      });
    });

    it("no-ops when preference does not exist", async () => {
      prismaMock.userPreference.deleteMany.mockResolvedValue({ count: 0 } as never);

      // Should not throw
      await caller.delete({ key: "nonexistent" });

      expect(prismaMock.userPreference.deleteMany).toHaveBeenCalled();
    });
  });
});
