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

vi.mock("@/server/services/pipeline-dependency", () => ({
  addDependency: vi.fn(),
  removeDependency: vi.fn(),
  getUpstreams: vi.fn(),
  getUndeployedUpstreams: vi.fn(),
  getDeployedDownstreams: vi.fn(),
  getDependencyGraph: vi.fn(),
}));

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { pipelineDependencyRouter } from "@/server/routers/pipeline-dependency";
import * as depService from "@/server/services/pipeline-dependency";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(pipelineDependencyRouter)({
  session: { user: { id: "user-1", email: "test@test.com" } },
  userRole: "EDITOR",
  teamId: "team-1",
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("pipeline-dependency router", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ─── list ──────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("returns upstream dependencies for a pipeline", async () => {
      const upstreams = [
        { id: "dep-1", upstreamId: "p-upstream", downstreamId: "p-1", description: "needs data" },
      ];
      vi.mocked(depService.getUpstreams).mockResolvedValue(upstreams as never);

      const result = await caller.list({ pipelineId: "p-1" });

      expect(result).toHaveLength(1);
      expect(depService.getUpstreams).toHaveBeenCalledWith("p-1");
    });
  });

  // ─── add ───────────────────────────────────────────────────────────────────

  describe("add", () => {
    it("creates a new dependency", async () => {
      const dep = {
        id: "dep-new",
        upstreamId: "p-upstream",
        downstreamId: "p-downstream",
        description: "log forwarding",
      };
      vi.mocked(depService.addDependency).mockResolvedValue(dep as never);

      const result = await caller.add({
        upstreamId: "p-upstream",
        downstreamId: "p-downstream",
        description: "log forwarding",
      });

      expect(result.id).toBe("dep-new");
      expect(depService.addDependency).toHaveBeenCalledWith(
        "p-upstream",
        "p-downstream",
        "log forwarding",
      );
    });
  });

  // ─── remove ────────────────────────────────────────────────────────────────

  describe("remove", () => {
    it("removes a dependency", async () => {
      vi.mocked(depService.removeDependency).mockResolvedValue({
        deleted: true,
      } as never);

      const result = await caller.remove({ id: "dep-1" });

      expect(result.deleted).toBe(true);
      expect(depService.removeDependency).toHaveBeenCalledWith("dep-1");
    });
  });

  // ─── listCandidates ───────────────────────────────────────────────────────

  describe("listCandidates", () => {
    it("returns other pipelines in the same environment", async () => {
      prismaMock.pipeline.findMany.mockResolvedValue([
        { id: "p-2", name: "Other Pipeline" },
      ] as never);

      const result = await caller.listCandidates({
        pipelineId: "p-1",
        environmentId: "env-1",
      });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Other Pipeline");
      expect(prismaMock.pipeline.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            environmentId: "env-1",
            id: { not: "p-1" },
          },
        }),
      );
    });
  });

  // ─── deployWarnings ───────────────────────────────────────────────────────

  describe("deployWarnings", () => {
    it("returns undeployed upstream dependencies", async () => {
      const warnings = [
        { id: "p-upstream", name: "Upstream Pipeline", deployed: false },
      ];
      vi.mocked(depService.getUndeployedUpstreams).mockResolvedValue(warnings as never);

      const result = await caller.deployWarnings({ pipelineId: "p-1" });

      expect(result).toHaveLength(1);
      expect(depService.getUndeployedUpstreams).toHaveBeenCalledWith("p-1");
    });
  });

  // ─── undeployWarnings ─────────────────────────────────────────────────────

  describe("undeployWarnings", () => {
    it("returns deployed downstream dependencies", async () => {
      const warnings = [
        { id: "p-downstream", name: "Downstream Pipeline", deployed: true },
      ];
      vi.mocked(depService.getDeployedDownstreams).mockResolvedValue(warnings as never);

      const result = await caller.undeployWarnings({ pipelineId: "p-1" });

      expect(result).toHaveLength(1);
      expect(depService.getDeployedDownstreams).toHaveBeenCalledWith("p-1");
    });
  });

  // ─── graph ─────────────────────────────────────────────────────────────────

  describe("graph", () => {
    it("returns the full dependency graph for an environment", async () => {
      const graph = {
        nodes: [{ id: "p-1", name: "Pipeline 1" }],
        edges: [{ source: "p-1", target: "p-2" }],
      };
      vi.mocked(depService.getDependencyGraph).mockResolvedValue(graph as never);

      const result = await caller.graph({ environmentId: "env-1" });

      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(1);
      expect(depService.getDependencyGraph).toHaveBeenCalledWith("env-1");
    });
  });
});
