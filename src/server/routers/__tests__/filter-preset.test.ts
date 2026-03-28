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

import { prisma } from "@/lib/prisma";
import { filterPresetRouter } from "@/server/routers/filter-preset";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(filterPresetRouter)({
  session: { user: { id: "user-1" } },
});

const NOW = new Date("2026-03-01T12:00:00Z");

function makePreset(overrides: Partial<{
  id: string;
  name: string;
  scope: string;
  isDefault: boolean;
  filters: Record<string, unknown>;
}> = {}) {
  return {
    id: overrides.id ?? "preset-1",
    name: overrides.name ?? "My Filter",
    environmentId: "env-1",
    scope: overrides.scope ?? "pipeline_list",
    filters: overrides.filters ?? { search: "nginx" },
    isDefault: overrides.isDefault ?? false,
    createdById: "user-1",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("filterPreset router", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  describe("list", () => {
    it("returns presets for environment and scope", async () => {
      const presets = [makePreset()];
      prismaMock.filterPreset.findMany.mockResolvedValueOnce(presets as never);

      const result = await caller.list({
        environmentId: "env-1",
        scope: "pipeline_list",
      });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("My Filter");
    });
  });

  describe("create", () => {
    it("creates a new preset", async () => {
      prismaMock.filterPreset.count.mockResolvedValueOnce(0);
      prismaMock.filterPreset.create.mockResolvedValueOnce(makePreset() as never);

      const result = await caller.create({
        environmentId: "env-1",
        name: "My Filter",
        scope: "pipeline_list",
        filters: { search: "nginx" },
      });

      expect(result.name).toBe("My Filter");
      expect(prismaMock.filterPreset.create).toHaveBeenCalledOnce();
    });

    it("rejects when 20 presets already exist", async () => {
      prismaMock.filterPreset.count.mockResolvedValueOnce(20);

      await expect(
        caller.create({
          environmentId: "env-1",
          name: "One Too Many",
          scope: "pipeline_list",
          filters: {},
        })
      ).rejects.toThrow();
    });
  });

  describe("update", () => {
    it("updates name and filters", async () => {
      prismaMock.filterPreset.findUnique.mockResolvedValueOnce(makePreset() as never);
      prismaMock.filterPreset.update.mockResolvedValueOnce(
        makePreset({ name: "Updated" }) as never
      );

      const result = await caller.update({
        environmentId: "env-1",
        id: "preset-1",
        name: "Updated",
      });

      expect(result.name).toBe("Updated");
    });

    it("rejects if preset not found", async () => {
      prismaMock.filterPreset.findUnique.mockResolvedValueOnce(null);

      await expect(
        caller.update({
          environmentId: "env-1",
          id: "missing",
          name: "Ghost",
        })
      ).rejects.toThrow();
    });
  });

  describe("delete", () => {
    it("deletes a preset", async () => {
      prismaMock.filterPreset.findUnique.mockResolvedValueOnce(makePreset() as never);
      prismaMock.filterPreset.delete.mockResolvedValueOnce(makePreset() as never);

      const result = await caller.delete({
        environmentId: "env-1",
        id: "preset-1",
      });

      expect(result).toEqual({ deleted: true });
    });
  });

  describe("setDefault", () => {
    it("clears existing default and sets new one", async () => {
      prismaMock.filterPreset.findUnique.mockResolvedValueOnce(makePreset() as never);
      prismaMock.filterPreset.updateMany.mockResolvedValueOnce({ count: 1 } as never);
      prismaMock.filterPreset.update.mockResolvedValueOnce(
        makePreset({ isDefault: true }) as never
      );

      const result = await caller.setDefault({
        environmentId: "env-1",
        id: "preset-1",
        scope: "pipeline_list",
      });

      expect(result.isDefault).toBe(true);
      expect(prismaMock.filterPreset.updateMany).toHaveBeenCalledWith({
        where: { environmentId: "env-1", scope: "pipeline_list", isDefault: true },
        data: { isDefault: false },
      });
    });
  });
});
