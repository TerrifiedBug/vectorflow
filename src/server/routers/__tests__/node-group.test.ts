import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import { TRPCError } from "@trpc/server";

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

// ─── Import SUT + mocks after vi.mock ───────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { nodeGroupRouter } from "@/server/routers/node-group";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(nodeGroupRouter)({
  session: { user: { id: "user-1" } },
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeNodeGroup(overrides: Partial<{
  id: string;
  name: string;
  environmentId: string;
  criteria: Record<string, string>;
  labelTemplate: Record<string, string>;
  requiredLabels: string[];
}> = {}) {
  return {
    id: overrides.id ?? "ng-1",
    name: overrides.name ?? "US East",
    environmentId: overrides.environmentId ?? "env-1",
    criteria: overrides.criteria ?? { region: "us-east" },
    labelTemplate: overrides.labelTemplate ?? { env: "prod" },
    requiredLabels: overrides.requiredLabels ?? ["region", "role"],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("nodeGroupRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  // ── list ────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("returns node groups for an environment ordered by name", async () => {
      const groups = [
        makeNodeGroup({ id: "ng-1", name: "EU West" }),
        makeNodeGroup({ id: "ng-2", name: "US East" }),
      ];
      prismaMock.nodeGroup.findMany.mockResolvedValue(groups as never);

      const result = await caller.list({ environmentId: "env-1" });

      expect(result).toEqual(groups);
      expect(prismaMock.nodeGroup.findMany).toHaveBeenCalledWith({
        where: { environmentId: "env-1" },
        orderBy: { name: "asc" },
      });
    });

    it("returns empty array when no groups exist", async () => {
      prismaMock.nodeGroup.findMany.mockResolvedValue([]);

      const result = await caller.list({ environmentId: "env-1" });

      expect(result).toEqual([]);
    });
  });

  // ── create ──────────────────────────────────────────────────────────────

  describe("create", () => {
    it("creates a node group with name, criteria, labelTemplate, requiredLabels", async () => {
      prismaMock.nodeGroup.findUnique.mockResolvedValue(null);
      const created = makeNodeGroup({ id: "ng-new", name: "Asia Pacific" });
      prismaMock.nodeGroup.create.mockResolvedValue(created as never);

      const result = await caller.create({
        environmentId: "env-1",
        name: "Asia Pacific",
        criteria: { region: "ap-southeast" },
        labelTemplate: { env: "prod", tier: "1" },
        requiredLabels: ["region", "role"],
      });

      expect(result).toEqual(created);
      expect(prismaMock.nodeGroup.create).toHaveBeenCalledWith({
        data: {
          name: "Asia Pacific",
          environmentId: "env-1",
          criteria: { region: "ap-southeast" },
          labelTemplate: { env: "prod", tier: "1" },
          requiredLabels: ["region", "role"],
        },
      });
    });

    it("throws CONFLICT when duplicate name in same environment", async () => {
      prismaMock.nodeGroup.findUnique.mockResolvedValue(makeNodeGroup() as never);

      await expect(
        caller.create({ environmentId: "env-1", name: "US East" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      expect(prismaMock.nodeGroup.create).not.toHaveBeenCalled();
    });

    it("rejects empty name (Zod validation)", async () => {
      await expect(
        caller.create({ environmentId: "env-1", name: "" }),
      ).rejects.toThrow();
    });
  });

  // ── update ──────────────────────────────────────────────────────────────

  describe("update", () => {
    it("updates group name", async () => {
      prismaMock.nodeGroup.findUnique
        .mockResolvedValueOnce(makeNodeGroup({ id: "ng-1", name: "Old Name" }) as never)
        .mockResolvedValueOnce(null); // no conflict

      const updated = makeNodeGroup({ id: "ng-1", name: "New Name" });
      prismaMock.nodeGroup.update.mockResolvedValue(updated as never);

      const result = await caller.update({ id: "ng-1", name: "New Name" });

      expect(result.name).toBe("New Name");
    });

    it("throws NOT_FOUND for non-existent group", async () => {
      prismaMock.nodeGroup.findUnique.mockResolvedValue(null);

      await expect(
        caller.update({ id: "nonexistent", name: "Foo" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws CONFLICT when renaming to existing name", async () => {
      prismaMock.nodeGroup.findUnique
        .mockResolvedValueOnce(makeNodeGroup({ id: "ng-1", name: "Alpha" }) as never)
        .mockResolvedValueOnce(makeNodeGroup({ id: "ng-2", name: "Beta" }) as never); // conflict!

      await expect(
        caller.update({ id: "ng-1", name: "Beta" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("skips uniqueness check when name is unchanged", async () => {
      prismaMock.nodeGroup.findUnique.mockResolvedValueOnce(
        makeNodeGroup({ id: "ng-1", name: "Same Name" }) as never,
      );

      prismaMock.nodeGroup.update.mockResolvedValue(
        makeNodeGroup({ id: "ng-1", name: "Same Name" }) as never,
      );

      await caller.update({ id: "ng-1", name: "Same Name" });

      // findUnique called only once (to fetch the group), not twice
      expect(prismaMock.nodeGroup.findUnique).toHaveBeenCalledTimes(1);
    });

    it("updates labelTemplate", async () => {
      prismaMock.nodeGroup.findUnique.mockResolvedValueOnce(
        makeNodeGroup({ id: "ng-1" }) as never,
      );

      const updated = makeNodeGroup({ id: "ng-1", labelTemplate: { env: "staging", tier: "2" } });
      prismaMock.nodeGroup.update.mockResolvedValue(updated as never);

      const result = await caller.update({ id: "ng-1", labelTemplate: { env: "staging", tier: "2" } });

      expect(prismaMock.nodeGroup.update).toHaveBeenCalledWith({
        where: { id: "ng-1" },
        data: { labelTemplate: { env: "staging", tier: "2" } },
      });
      expect(result).toEqual(updated);
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes an existing group", async () => {
      prismaMock.nodeGroup.findUnique.mockResolvedValue({ id: "ng-1" } as never);
      prismaMock.nodeGroup.delete.mockResolvedValue(makeNodeGroup({ id: "ng-1" }) as never);

      const result = await caller.delete({ id: "ng-1" });

      expect(result.id).toBe("ng-1");
      expect(prismaMock.nodeGroup.delete).toHaveBeenCalledWith({
        where: { id: "ng-1" },
      });
    });

    it("throws NOT_FOUND for non-existent group", async () => {
      prismaMock.nodeGroup.findUnique.mockResolvedValue(null);

      await expect(
        caller.delete({ id: "nonexistent" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
