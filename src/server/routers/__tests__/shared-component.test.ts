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

vi.mock("@/server/services/config-crypto", () => ({
  encryptNodeConfig: vi.fn((_: unknown, c: unknown) => c),
  decryptNodeConfig: vi.fn((_: unknown, c: unknown) => c),
}));

import { prisma } from "@/lib/prisma";
import { sharedComponentRouter } from "@/server/routers/shared-component";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(sharedComponentRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

const NOW = new Date("2026-03-01T12:00:00Z");

function makeSC(overrides: Record<string, unknown> = {}) {
  return {
    id: "sc-1",
    name: "Shared Source",
    description: "A shared component",
    componentType: "http_server",
    kind: "source",
    config: { address: "0.0.0.0:8080" },
    version: 1,
    environmentId: "env-1",
    createdAt: NOW,
    updatedAt: NOW,
    linkedNodes: [],
    ...overrides,
  };
}

describe("sharedComponentRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("returns shared components with linkedPipelineCount", async () => {
      const sc = makeSC({
        linkedNodes: [
          { pipelineId: "pipe-1" },
          { pipelineId: "pipe-1" },
          { pipelineId: "pipe-2" },
        ],
      });
      prismaMock.sharedComponent.findMany.mockResolvedValueOnce([sc] as never);

      const result = await caller.list({ environmentId: "env-1" });

      expect(result).toHaveLength(1);
      expect(result[0].linkedPipelineCount).toBe(2);
      expect(result[0].name).toBe("Shared Source");
    });
  });

  describe("getById", () => {
    it("returns a shared component with linked pipelines", async () => {
      const sc = makeSC({
        linkedNodes: [
          {
            pipelineId: "pipe-1",
            sharedComponentVersion: 1,
            pipeline: { id: "pipe-1", name: "Pipeline 1" },
          },
        ],
      });
      prismaMock.sharedComponent.findUnique.mockResolvedValueOnce(sc as never);

      const result = await caller.getById({ id: "sc-1", environmentId: "env-1" });

      expect(result.id).toBe("sc-1");
      expect(result.linkedPipelines).toHaveLength(1);
      expect(result.linkedPipelines[0].isStale).toBe(false);
    });

    it("throws NOT_FOUND when component does not exist", async () => {
      prismaMock.sharedComponent.findUnique.mockResolvedValueOnce(null);

      await expect(
        caller.getById({ id: "missing", environmentId: "env-1" }),
      ).rejects.toThrow("Shared component not found");
    });

    it("throws NOT_FOUND when environmentId does not match", async () => {
      const sc = makeSC({ environmentId: "env-other" });
      prismaMock.sharedComponent.findUnique.mockResolvedValueOnce(sc as never);

      await expect(
        caller.getById({ id: "sc-1", environmentId: "env-1" }),
      ).rejects.toThrow("Shared component not found");
    });
  });

  describe("create", () => {
    it("creates a new shared component", async () => {
      const sc = makeSC();
      prismaMock.$transaction.mockImplementationOnce(async (fn: (tx: typeof prismaMock) => Promise<unknown>) => {
        return fn(prismaMock);
      });
      prismaMock.sharedComponent.findUnique.mockResolvedValueOnce(null);
      prismaMock.sharedComponent.create.mockResolvedValueOnce(sc as never);

      const result = await caller.create({
        environmentId: "env-1",
        name: "Shared Source",
        componentType: "http_server",
        kind: "SOURCE",
        config: { address: "0.0.0.0:8080" },
      });

      expect(result.name).toBe("Shared Source");
    });

    it("throws CONFLICT on duplicate name in same environment", async () => {
      const existing = makeSC();
      prismaMock.$transaction.mockImplementationOnce(async (fn: (tx: typeof prismaMock) => Promise<unknown>) => {
        return fn(prismaMock);
      });
      prismaMock.sharedComponent.findUnique.mockResolvedValueOnce(existing as never);

      await expect(
        caller.create({
          environmentId: "env-1",
          name: "Shared Source",
          componentType: "http_server",
          kind: "SOURCE",
          config: { address: "0.0.0.0:8080" },
        }),
      ).rejects.toThrow("already exists");
    });
  });

  describe("update", () => {
    it("updates name and config with version bump", async () => {
      const sc = makeSC();
      const updated = makeSC({ name: "Updated", version: 2 });
      prismaMock.$transaction.mockImplementationOnce(async (fn: (tx: typeof prismaMock) => Promise<unknown>) => {
        return fn(prismaMock);
      });
      prismaMock.sharedComponent.findUnique
        .mockResolvedValueOnce(sc as never)   // initial lookup
        .mockResolvedValueOnce(null);          // name conflict check
      prismaMock.sharedComponent.update.mockResolvedValueOnce(updated as never);

      const result = await caller.update({
        id: "sc-1",
        environmentId: "env-1",
        name: "Updated",
        config: { address: "0.0.0.0:9090" },
      });

      expect(result.name).toBe("Updated");
      expect(prismaMock.sharedComponent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "Updated",
            version: { increment: 1 },
          }),
        }),
      );
    });
  });

  describe("delete", () => {
    it("deletes an existing shared component", async () => {
      const sc = makeSC();
      prismaMock.sharedComponent.findUnique.mockResolvedValueOnce(sc as never);
      prismaMock.sharedComponent.delete.mockResolvedValueOnce(sc as never);

      const result = await caller.delete({ id: "sc-1", environmentId: "env-1" });

      expect(result.id).toBe("sc-1");
    });

    it("throws NOT_FOUND when component does not exist", async () => {
      prismaMock.sharedComponent.findUnique.mockResolvedValueOnce(null);

      await expect(
        caller.delete({ id: "missing", environmentId: "env-1" }),
      ).rejects.toThrow("Shared component not found");
    });
  });

  describe("acceptUpdate", () => {
    it("copies latest config from shared component into the node", async () => {
      const node = {
        id: "node-1",
        pipelineId: "pipe-1",
        componentType: "http_server",
        sharedComponent: {
          id: "sc-1",
          componentType: "http_server",
          config: { address: "0.0.0.0:9090" },
          version: 2,
        },
      };
      prismaMock.pipelineNode.findUnique.mockResolvedValueOnce(node as never);
      prismaMock.pipelineNode.update.mockResolvedValueOnce({} as never);

      const result = await caller.acceptUpdate({ nodeId: "node-1", pipelineId: "pipe-1" });

      expect(result.version).toBe(2);
      expect(result.config).toEqual({ address: "0.0.0.0:9090" });
    });

    it("throws BAD_REQUEST when node is not linked to shared component", async () => {
      const node = {
        id: "node-1",
        pipelineId: "pipe-1",
        sharedComponent: null,
      };
      prismaMock.pipelineNode.findUnique.mockResolvedValueOnce(node as never);

      await expect(
        caller.acceptUpdate({ nodeId: "node-1", pipelineId: "pipe-1" }),
      ).rejects.toThrow("Node is not linked to a shared component");
    });
  });

  describe("unlink", () => {
    it("unlinks a node from its shared component", async () => {
      const node = { id: "node-1", pipelineId: "pipe-1" };
      prismaMock.pipelineNode.findUnique.mockResolvedValueOnce(node as never);
      prismaMock.pipelineNode.update.mockResolvedValueOnce({
        ...node,
        sharedComponentId: null,
        sharedComponentVersion: null,
      } as never);

      const result = await caller.unlink({ nodeId: "node-1", pipelineId: "pipe-1" });

      expect(result.sharedComponentId).toBeNull();
      expect(prismaMock.pipelineNode.update).toHaveBeenCalledWith({
        where: { id: "node-1" },
        data: { sharedComponentId: null, sharedComponentVersion: null },
      });
    });

    it("throws NOT_FOUND when node does not exist", async () => {
      prismaMock.pipelineNode.findUnique.mockResolvedValueOnce(null);

      await expect(
        caller.unlink({ nodeId: "missing", pipelineId: "pipe-1" }),
      ).rejects.toThrow("Pipeline node not found");
    });
  });
});
