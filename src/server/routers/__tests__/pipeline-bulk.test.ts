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

const mockDeployAgent = vi.fn();
const mockUndeployAgent = vi.fn();
const mockDeployBatch = vi.fn();

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

vi.mock("@/server/services/deploy-agent", () => ({
  deployAgent: (...args: unknown[]) => mockDeployAgent(...args),
  undeployAgent: (...args: unknown[]) => mockUndeployAgent(...args),
  deployBatch: (...args: unknown[]) => mockDeployBatch(...args),
}));

vi.mock("@/server/services/pipeline-graph", () => ({
  saveGraphComponents: vi.fn(),
  promotePipeline: vi.fn(),
  discardPipelineChanges: vi.fn(),
  detectConfigChanges: vi.fn(),
  listPipelinesForEnvironment: vi.fn(),
}));

vi.mock("@/server/services/pipeline-version", () => ({
  createVersion: vi.fn(),
  listVersions: vi.fn(),
  listVersionsSummary: vi.fn(),
  getVersion: vi.fn(),
  rollback: vi.fn(),
}));

vi.mock("@/server/services/config-crypto", () => ({
  decryptNodeConfig: vi.fn((_, c: unknown) => c),
}));

vi.mock("@/server/services/system-environment", () => ({
  getOrCreateSystemEnvironment: vi.fn(),
}));

vi.mock("@/server/services/copy-pipeline-graph", () => ({
  copyPipelineGraph: vi.fn(),
}));

vi.mock("@/server/services/git-sync", () => ({
  gitSyncDeletePipeline: vi.fn(),
}));

vi.mock("@/server/services/sli-evaluator", () => ({
  evaluatePipelineHealth: vi.fn(),
}));

vi.mock("@/server/services/batch-health", () => ({
  batchEvaluatePipelineHealth: vi.fn(),
}));

vi.mock("@/server/services/push-registry", () => ({
  pushRegistry: { notify: vi.fn() },
}));

vi.mock("@/server/services/sse-registry", () => ({
  sseRegistry: { broadcast: vi.fn() },
}));

vi.mock("@/server/services/event-alerts", () => ({
  fireEventAlert: vi.fn(),
}));

// ─── Import SUT + mocks ────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { pipelineRouter } from "@/server/routers/pipeline";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(pipelineRouter)({
  session: { user: { id: "user-1" } },
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("bulk operations", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    mockDeployAgent.mockReset();
    mockUndeployAgent.mockReset();
    mockDeployBatch.mockReset();
  });

  describe("deployBatch", () => {
    it("deploys multiple pipelines via deployBatch service and returns summary", async () => {
      mockDeployBatch.mockResolvedValue({
        total: 2,
        completed: 2,
        failed: 0,
        results: [
          { pipelineId: "p1", success: true, versionId: "v1", versionNumber: 1 },
          { pipelineId: "p2", success: true, versionId: "v2", versionNumber: 1 },
        ],
      });

      const result = await caller.deployBatch({
        pipelineIds: ["p1", "p2"],
        changelog: "Bulk deploy",
      });

      expect(result.total).toBe(2);
      expect(result.completed).toBe(2);
      expect(mockDeployBatch).toHaveBeenCalledWith(["p1", "p2"], "user-1", "Bulk deploy");
    });

    it("reports partial failures from deployBatch service", async () => {
      mockDeployBatch.mockResolvedValue({
        total: 3,
        completed: 1,
        failed: 2,
        results: [
          { pipelineId: "p1", success: true, versionId: "v1", versionNumber: 1 },
          { pipelineId: "p2", success: false, error: "Validation failed" },
          { pipelineId: "p3", success: false, error: "Deployment failed" },
        ],
      });

      const result = await caller.deployBatch({
        pipelineIds: ["p1", "p2", "p3"],
        changelog: "Deploy all",
      });

      expect(result.total).toBe(3);
      expect(result.completed).toBe(1);
      expect(result.failed).toBe(2);
      expect(result.results[0]).toMatchObject({ pipelineId: "p1", success: true });
      expect(result.results[1]).toMatchObject({
        pipelineId: "p2",
        success: false,
        error: "Validation failed",
      });
    });
  });

  describe("bulkUndeploy", () => {
    it("undeploys multiple pipelines", async () => {
      mockUndeployAgent
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true });

      const result = await caller.bulkUndeploy({ pipelineIds: ["p1", "p2"] });

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(2);
    });

    it("handles partial failures", async () => {
      mockUndeployAgent
        .mockResolvedValueOnce({ success: true })
        .mockRejectedValueOnce(new Error("Agent unreachable"));

      const result = await caller.bulkUndeploy({ pipelineIds: ["p1", "p2"] });

      expect(result.succeeded).toBe(1);
      expect(result.results[1]).toMatchObject({
        pipelineId: "p2",
        success: false,
        error: "Agent unreachable",
      });
    });
  });

  describe("bulkDelete", () => {
    it("deletes multiple pipelines", async () => {
      prismaMock.pipeline.findUnique
        .mockResolvedValueOnce({ id: "p1", isSystem: false, deployedAt: null, environmentId: "env-1" } as never)
        .mockResolvedValueOnce({ id: "p2", isSystem: false, deployedAt: null, environmentId: "env-1" } as never);
      prismaMock.pipeline.delete.mockResolvedValue({} as never);

      const result = await caller.bulkDelete({ pipelineIds: ["p1", "p2"] });

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(prismaMock.pipeline.delete).toHaveBeenCalledTimes(2);
    });

    it("skips system pipelines", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValueOnce({
        id: "p1", isSystem: true, deployedAt: null, environmentId: "env-1",
      } as never);

      const result = await caller.bulkDelete({ pipelineIds: ["p1"] });

      expect(result.succeeded).toBe(0);
      expect(result.results[0]).toMatchObject({
        pipelineId: "p1",
        success: false,
        error: "Cannot delete system pipeline",
      });
      expect(prismaMock.pipeline.delete).not.toHaveBeenCalled();
    });

    it("skips not-found pipelines", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValueOnce(null);

      const result = await caller.bulkDelete({ pipelineIds: ["missing"] });

      expect(result.succeeded).toBe(0);
      expect(result.results[0].error).toBe("Pipeline not found");
    });

    it("undeploys before deleting deployed pipelines", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValueOnce({
        id: "p1", isSystem: false, deployedAt: new Date(), environmentId: "env-1",
      } as never);
      prismaMock.pipeline.update.mockResolvedValue({} as never);
      prismaMock.pipeline.delete.mockResolvedValue({} as never);

      const result = await caller.bulkDelete({ pipelineIds: ["p1"] });

      expect(result.succeeded).toBe(1);
      expect(prismaMock.pipeline.update).toHaveBeenCalledWith({
        where: { id: "p1" },
        data: { isDraft: true, deployedAt: null },
      });
    });

    it("continues on mixed success/failure", async () => {
      prismaMock.pipeline.findUnique
        .mockResolvedValueOnce({ id: "p1", isSystem: false, deployedAt: null, environmentId: "env-1" } as never)
        .mockResolvedValueOnce({ id: "p2", isSystem: true, deployedAt: null, environmentId: "env-1" } as never)
        .mockResolvedValueOnce(null);
      prismaMock.pipeline.delete.mockResolvedValue({} as never);

      const result = await caller.bulkDelete({ pipelineIds: ["p1", "p2", "p3"] });

      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(1);
      expect(result.results[0]).toMatchObject({ pipelineId: "p1", success: true });
      expect(result.results[1]).toMatchObject({ pipelineId: "p2", success: false });
      expect(result.results[2]).toMatchObject({ pipelineId: "p3", success: false });
    });
  });
});
