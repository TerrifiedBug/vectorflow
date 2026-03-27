import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import { TRPCError } from "@trpc/server";

// ─── vi.hoisted so `t` is available inside vi.mock factories ────────────────

const { t } = vi.hoisted(() => {
  // Dynamic import won't work in hoisted block; inline the init
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
import { pipelineGroupRouter } from "@/server/routers/pipeline-group";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(pipelineGroupRouter)({
  session: { user: { id: "user-1" } },
});

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: "g1",
    name: "Backend",
    color: "#ff0000",
    environmentId: "env-1",
    parentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    _count: { pipelines: 0, children: 0 },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("pipelineGroupRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  // ── list ────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("returns groups ordered by name with pipeline counts", async () => {
      const groups = [
        makeGroup({ id: "g1", name: "Backend", _count: { pipelines: 3, children: 1 } }),
        makeGroup({ id: "g2", name: "Frontend", color: null, _count: { pipelines: 0, children: 0 } }),
      ];
      prismaMock.pipelineGroup.findMany.mockResolvedValue(groups as never);

      const result = await caller.list({ environmentId: "env-1" });

      expect(result).toEqual(groups);
      expect(prismaMock.pipelineGroup.findMany).toHaveBeenCalledWith({
        where: { environmentId: "env-1" },
        include: { _count: { select: { pipelines: true, children: true } } },
        orderBy: { name: "asc" },
      });
    });

    it("returns groups with parentId field", async () => {
      const groups = [
        makeGroup({ id: "g1", name: "Parent", parentId: null }),
        makeGroup({ id: "g2", name: "Child", parentId: "g1" }),
      ];
      prismaMock.pipelineGroup.findMany.mockResolvedValue(groups as never);

      const result = await caller.list({ environmentId: "env-1" });

      expect(result[1]).toMatchObject({ parentId: "g1" });
    });

    it("returns empty array when no groups exist", async () => {
      prismaMock.pipelineGroup.findMany.mockResolvedValue([]);

      const result = await caller.list({ environmentId: "env-1" });

      expect(result).toEqual([]);
    });
  });

  // ── create ──────────────────────────────────────────────────────────────

  describe("create", () => {
    it("creates a group with name and color", async () => {
      prismaMock.pipelineGroup.findFirst.mockResolvedValue(null);
      const created = makeGroup({ id: "g-new", name: "Infra", color: "#00ff00" });
      prismaMock.pipelineGroup.create.mockResolvedValue(created as never);

      const result = await caller.create({
        environmentId: "env-1",
        name: "Infra",
        color: "#00ff00",
      });

      expect(result).toEqual(created);
      expect(prismaMock.pipelineGroup.create).toHaveBeenCalledWith({
        data: { name: "Infra", color: "#00ff00", environmentId: "env-1", parentId: null },
      });
    });

    it("creates a group without color", async () => {
      prismaMock.pipelineGroup.findFirst.mockResolvedValue(null);
      prismaMock.pipelineGroup.create.mockResolvedValue(makeGroup({ name: "Logs", color: null }) as never);

      const result = await caller.create({
        environmentId: "env-1",
        name: "Logs",
      });

      expect(result.color).toBeNull();
    });

    it("creates a child group with parentId", async () => {
      prismaMock.pipelineGroup.findFirst.mockResolvedValue(null);
      // parent at depth 1 (root), no grandparent
      prismaMock.pipelineGroup.findUnique.mockResolvedValue({
        id: "parent-1",
        parentId: null,
        parent: null,
      } as never);
      const created = makeGroup({ id: "child-1", name: "Child", parentId: "parent-1" });
      prismaMock.pipelineGroup.create.mockResolvedValue(created as never);

      const result = await caller.create({
        environmentId: "env-1",
        name: "Child",
        parentId: "parent-1",
      });

      expect(result.parentId).toBe("parent-1");
      expect(prismaMock.pipelineGroup.create).toHaveBeenCalledWith({
        data: { name: "Child", color: undefined, environmentId: "env-1", parentId: "parent-1" },
      });
    });

    it("creates a group at depth 3 (parent at depth 2) successfully", async () => {
      prismaMock.pipelineGroup.findFirst.mockResolvedValue(null);
      // parent is at depth 2 (has a parent at depth 1 with no grandparent)
      prismaMock.pipelineGroup.findUnique.mockResolvedValue({
        id: "depth2-group",
        parentId: "depth1-group",
        parent: { parentId: null },
      } as never);
      const created = makeGroup({ id: "depth3-group", name: "Deep", parentId: "depth2-group" });
      prismaMock.pipelineGroup.create.mockResolvedValue(created as never);

      const result = await caller.create({
        environmentId: "env-1",
        name: "Deep",
        parentId: "depth2-group",
      });

      expect(result.id).toBe("depth3-group");
    });

    it("rejects creating a group at depth 4 (Maximum group nesting depth exceeded)", async () => {
      prismaMock.pipelineGroup.findFirst.mockResolvedValue(null);
      // parent is at depth 3 (has parentId and parent.parentId is non-null)
      prismaMock.pipelineGroup.findUnique.mockResolvedValue({
        id: "depth3-group",
        parentId: "depth2-group",
        parent: { parentId: "depth1-group" },
      } as never);

      await expect(
        caller.create({
          environmentId: "env-1",
          name: "TooDeep",
          parentId: "depth3-group",
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("Maximum group nesting depth (3) exceeded"),
      });
    });

    it("throws NOT_FOUND when parentId does not exist", async () => {
      prismaMock.pipelineGroup.findFirst.mockResolvedValue(null);
      prismaMock.pipelineGroup.findUnique.mockResolvedValue(null);

      await expect(
        caller.create({
          environmentId: "env-1",
          name: "Orphan",
          parentId: "nonexistent",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws CONFLICT when duplicate name under the same parent", async () => {
      // findFirst returns existing group with same name + parentId
      prismaMock.pipelineGroup.findFirst.mockResolvedValue(makeGroup({ name: "Infra", parentId: "parent-1" }) as never);

      await expect(
        caller.create({ environmentId: "env-1", name: "Infra", parentId: "parent-1" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("throws CONFLICT when duplicate name at root level in same environment", async () => {
      prismaMock.pipelineGroup.findFirst.mockResolvedValue(makeGroup({ name: "Root Group", parentId: null }) as never);

      await expect(
        caller.create({ environmentId: "env-1", name: "Root Group" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("allows duplicate names under different parents", async () => {
      // findFirst returns null (no conflict since different parent)
      prismaMock.pipelineGroup.findFirst.mockResolvedValue(null);
      prismaMock.pipelineGroup.findUnique.mockResolvedValue({
        id: "parent-2",
        parentId: null,
        parent: null,
      } as never);
      const created = makeGroup({ id: "g-dup", name: "Shared Name", parentId: "parent-2" });
      prismaMock.pipelineGroup.create.mockResolvedValue(created as never);

      const result = await caller.create({
        environmentId: "env-1",
        name: "Shared Name",
        parentId: "parent-2",
      });

      expect(result.name).toBe("Shared Name");
    });

    it("rejects empty name", async () => {
      await expect(
        caller.create({ environmentId: "env-1", name: "" }),
      ).rejects.toThrow(); // zod validation
    });

    it("rejects name exceeding 100 characters", async () => {
      await expect(
        caller.create({ environmentId: "env-1", name: "x".repeat(101) }),
      ).rejects.toThrow();
    });
  });

  // ── update ──────────────────────────────────────────────────────────────

  describe("update", () => {
    it("updates group name", async () => {
      prismaMock.pipelineGroup.findUnique.mockResolvedValueOnce(
        makeGroup({ id: "g1", name: "Old Name", parentId: null }) as never,
      );
      prismaMock.pipelineGroup.findFirst.mockResolvedValueOnce(null); // no conflict

      prismaMock.pipelineGroup.update.mockResolvedValue(
        makeGroup({ id: "g1", name: "New Name" }) as never,
      );

      const result = await caller.update({ id: "g1", name: "New Name" });

      expect(result.name).toBe("New Name");
    });

    it("updates group color to null", async () => {
      prismaMock.pipelineGroup.findUnique.mockResolvedValueOnce(
        makeGroup({ id: "g1", name: "Infra", color: "#ff0000", parentId: null }) as never,
      );

      prismaMock.pipelineGroup.update.mockResolvedValue(
        makeGroup({ id: "g1", name: "Infra", color: null }) as never,
      );

      const result = await caller.update({ id: "g1", color: null });

      expect(result.color).toBeNull();
      expect(prismaMock.pipelineGroup.update).toHaveBeenCalledWith({
        where: { id: "g1" },
        data: { color: null },
      });
    });

    it("throws NOT_FOUND for non-existent group", async () => {
      prismaMock.pipelineGroup.findUnique.mockResolvedValue(null);

      await expect(
        caller.update({ id: "nonexistent", name: "Foo" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws CONFLICT when renaming to an existing name in same parent", async () => {
      prismaMock.pipelineGroup.findUnique.mockResolvedValueOnce(
        makeGroup({ id: "g1", name: "Alpha", parentId: null }) as never,
      );
      prismaMock.pipelineGroup.findFirst.mockResolvedValueOnce(
        makeGroup({ id: "g2", name: "Beta", parentId: null }) as never, // conflict
      );

      await expect(
        caller.update({ id: "g1", name: "Beta" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("skips uniqueness check when name is unchanged", async () => {
      prismaMock.pipelineGroup.findUnique.mockResolvedValueOnce(
        makeGroup({ id: "g1", name: "Same Name", parentId: null }) as never,
      );

      prismaMock.pipelineGroup.update.mockResolvedValue(
        makeGroup({ id: "g1", name: "Same Name", color: "#000" }) as never,
      );

      await caller.update({ id: "g1", name: "Same Name", color: "#000" });

      // findFirst should NOT be called (no name change, skip uniqueness check)
      expect(prismaMock.pipelineGroup.findFirst).not.toHaveBeenCalled();
    });

    it("enforces depth guard when updating parentId", async () => {
      prismaMock.pipelineGroup.findUnique
        .mockResolvedValueOnce(makeGroup({ id: "g1", name: "Group", parentId: null }) as never) // fetch group
        .mockResolvedValueOnce({
          id: "depth3-group",
          parentId: "depth2-group",
          parent: { parentId: "depth1-group" },
        } as never); // depth guard: parent at depth 3
      prismaMock.pipelineGroup.findFirst.mockResolvedValueOnce(null);

      await expect(
        caller.update({ id: "g1", parentId: "depth3-group" }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("Maximum group nesting depth (3) exceeded"),
      });
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes an existing group", async () => {
      prismaMock.pipelineGroup.findUnique.mockResolvedValue({
        id: "g1",
      } as never);
      prismaMock.pipelineGroup.delete.mockResolvedValue(
        makeGroup({ id: "g1", name: "Deleted" }) as never,
      );

      const result = await caller.delete({ id: "g1" });

      expect(result.id).toBe("g1");
      expect(prismaMock.pipelineGroup.delete).toHaveBeenCalledWith({
        where: { id: "g1" },
      });
    });

    it("throws NOT_FOUND for non-existent group", async () => {
      prismaMock.pipelineGroup.findUnique.mockResolvedValue(null);

      await expect(
        caller.delete({ id: "nonexistent" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("deletes group with children (SetNull cascade handles children parentId)", async () => {
      // onDelete:SetNull handles this in DB — we just verify delete is called
      prismaMock.pipelineGroup.findUnique.mockResolvedValue({ id: "parent-g" } as never);
      prismaMock.pipelineGroup.delete.mockResolvedValue(
        makeGroup({ id: "parent-g", name: "Parent" }) as never,
      );

      const result = await caller.delete({ id: "parent-g" });

      expect(result.id).toBe("parent-g");
    });
  });
});
