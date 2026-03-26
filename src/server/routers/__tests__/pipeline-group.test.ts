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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("pipelineGroupRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  // ── list ────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("returns groups ordered by name with pipeline counts", async () => {
      const groups = [
        { id: "g1", name: "Backend", color: "#ff0000", environmentId: "env-1", createdAt: new Date(), updatedAt: new Date(), _count: { pipelines: 3 } },
        { id: "g2", name: "Frontend", color: null, environmentId: "env-1", createdAt: new Date(), updatedAt: new Date(), _count: { pipelines: 0 } },
      ];
      prismaMock.pipelineGroup.findMany.mockResolvedValue(groups as never);

      const result = await caller.list({ environmentId: "env-1" });

      expect(result).toEqual(groups);
      expect(prismaMock.pipelineGroup.findMany).toHaveBeenCalledWith({
        where: { environmentId: "env-1" },
        include: { _count: { select: { pipelines: true } } },
        orderBy: { name: "asc" },
      });
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
      prismaMock.pipelineGroup.findUnique.mockResolvedValue(null);
      const created = {
        id: "g-new", name: "Infra", color: "#00ff00",
        environmentId: "env-1", createdAt: new Date(), updatedAt: new Date(),
      };
      prismaMock.pipelineGroup.create.mockResolvedValue(created as never);

      const result = await caller.create({
        environmentId: "env-1",
        name: "Infra",
        color: "#00ff00",
      });

      expect(result).toEqual(created);
      expect(prismaMock.pipelineGroup.create).toHaveBeenCalledWith({
        data: { name: "Infra", color: "#00ff00", environmentId: "env-1" },
      });
    });

    it("creates a group without color", async () => {
      prismaMock.pipelineGroup.findUnique.mockResolvedValue(null);
      prismaMock.pipelineGroup.create.mockResolvedValue({
        id: "g-new", name: "Logs", color: null,
        environmentId: "env-1", createdAt: new Date(), updatedAt: new Date(),
      } as never);

      const result = await caller.create({
        environmentId: "env-1",
        name: "Logs",
      });

      expect(result.color).toBeNull();
    });

    it("throws CONFLICT when duplicate name in same environment", async () => {
      prismaMock.pipelineGroup.findUnique.mockResolvedValue({
        id: "existing", name: "Infra", color: null,
        environmentId: "env-1", createdAt: new Date(), updatedAt: new Date(),
      } as never);

      await expect(
        caller.create({ environmentId: "env-1", name: "Infra" }),
      ).rejects.toThrow(TRPCError);

      await expect(
        caller.create({ environmentId: "env-1", name: "Infra" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
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
      prismaMock.pipelineGroup.findUnique
        .mockResolvedValueOnce({
          id: "g1", name: "Old Name", environmentId: "env-1",
          color: null, createdAt: new Date(), updatedAt: new Date(),
        } as never)
        .mockResolvedValueOnce(null); // no conflict

      prismaMock.pipelineGroup.update.mockResolvedValue({
        id: "g1", name: "New Name", color: null,
        environmentId: "env-1", createdAt: new Date(), updatedAt: new Date(),
      } as never);

      const result = await caller.update({ id: "g1", name: "New Name" });

      expect(result.name).toBe("New Name");
    });

    it("updates group color to null", async () => {
      prismaMock.pipelineGroup.findUnique.mockResolvedValueOnce({
        id: "g1", name: "Infra", environmentId: "env-1",
        color: "#ff0000", createdAt: new Date(), updatedAt: new Date(),
      } as never);

      prismaMock.pipelineGroup.update.mockResolvedValue({
        id: "g1", name: "Infra", color: null,
        environmentId: "env-1", createdAt: new Date(), updatedAt: new Date(),
      } as never);

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

    it("throws CONFLICT when renaming to an existing name", async () => {
      prismaMock.pipelineGroup.findUnique
        .mockResolvedValueOnce({
          id: "g1", name: "Alpha", environmentId: "env-1",
          color: null, createdAt: new Date(), updatedAt: new Date(),
        } as never)
        .mockResolvedValueOnce({
          id: "g2", name: "Beta", environmentId: "env-1",
          color: null, createdAt: new Date(), updatedAt: new Date(),
        } as never); // conflict!

      await expect(
        caller.update({ id: "g1", name: "Beta" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("skips uniqueness check when name is unchanged", async () => {
      prismaMock.pipelineGroup.findUnique.mockResolvedValueOnce({
        id: "g1", name: "Same Name", environmentId: "env-1",
        color: null, createdAt: new Date(), updatedAt: new Date(),
      } as never);

      prismaMock.pipelineGroup.update.mockResolvedValue({
        id: "g1", name: "Same Name", color: "#000",
        environmentId: "env-1", createdAt: new Date(), updatedAt: new Date(),
      } as never);

      await caller.update({ id: "g1", name: "Same Name", color: "#000" });

      // findUnique called only once (to fetch the group), not twice (no conflict check)
      expect(prismaMock.pipelineGroup.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes an existing group", async () => {
      prismaMock.pipelineGroup.findUnique.mockResolvedValue({
        id: "g1",
      } as never);
      prismaMock.pipelineGroup.delete.mockResolvedValue({
        id: "g1", name: "Deleted", color: null,
        environmentId: "env-1", createdAt: new Date(), updatedAt: new Date(),
      } as never);

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
  });
});
