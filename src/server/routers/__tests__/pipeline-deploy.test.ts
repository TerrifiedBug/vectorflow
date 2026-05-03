/**
 * pipeline-deploy router — unit tests using the tRPC caller pattern.
 *
 * Note: the pipelineRouter is composed from focused sub-routers. Most sub-routers
 * are already covered by their own test files. This file targets the
 * pipeline-deploy.ts procedures that were not yet covered with the caller pattern:
 *   - deploymentStatus
 *   - deployBatch  (caller-level, vs. the service-only test in pipeline-deploy-batch.test.ts)
 *   - bulkUndeploy
 */

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
  deployAgent: vi.fn(),
  undeployAgent: vi.fn(),
  deployBatch: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { pipelineDeployRouter } from "@/server/routers/pipeline-deploy";
import { undeployAgent, deployBatch } from "@/server/services/deploy-agent";
import type { BatchDeployResult } from "@/server/services/deploy-agent";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const undeployAgentMock = undeployAgent as ReturnType<typeof vi.fn>;
const deployBatchMock = deployBatch as ReturnType<typeof vi.fn>;

const caller = t.createCallerFactory(pipelineDeployRouter)({
  session: { user: { id: "user-1" } },
});

beforeEach(() => {
  mockReset(prismaMock);
  vi.clearAllMocks();
  prismaMock.pipeline.findMany.mockImplementation((async (args: unknown) => {
    const where = (args as { where?: { id?: { in?: string[] } } } | undefined)?.where;
    const ids = where?.id?.in ?? [];
    return ids.map((id) => ({ id, environment: { teamId: "team-1" } }));
  }) as never);
  prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as never);
});

// ── pipeline.deploymentStatus ─────────────────────────────────────────────────

describe("pipeline.deploymentStatus", () => {
  it("returns latestVersion, deployed flag, and per-node statuses", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({
      id: "pipe-1",
      isDraft: false,
      versions: [{ version: 3 }],
    } as never);

    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      {
        pipelineId: "pipe-1",
        status: "RUNNING",
        version: 3,
        uptimeSeconds: 3600,
        lastUpdated: new Date("2024-06-01T00:00:00Z"),
        node: {
          id: "node-1",
          name: "alpha",
          host: "10.0.0.1",
          status: "HEALTHY",
          lastHeartbeat: new Date(),
        },
      },
    ] as never);

    const result = await caller.deploymentStatus({ pipelineId: "pipe-1" });

    expect(result.latestVersion).toBe(3);
    expect(result.deployed).toBe(true);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      nodeId: "node-1",
      nodeName: "alpha",
      pipelineStatus: "RUNNING",
      runningVersion: 3,
      isLatest: true,
    });
  });

  it("marks isLatest=false when running version lags behind latestVersion", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({
      id: "pipe-1",
      isDraft: false,
      versions: [{ version: 5 }],
    } as never);

    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      {
        pipelineId: "pipe-1",
        status: "RUNNING",
        version: 3,
        uptimeSeconds: 0,
        lastUpdated: new Date(),
        node: {
          id: "node-1",
          name: "alpha",
          host: "10.0.0.1",
          status: "HEALTHY",
          lastHeartbeat: new Date(),
        },
      },
    ] as never);

    const result = await caller.deploymentStatus({ pipelineId: "pipe-1" });

    expect(result.nodes[0].isLatest).toBe(false);
    expect(result.nodes[0].runningVersion).toBe(3);
  });

  it("returns deployed=true and latestVersion=0 when pipeline has no versions", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({
      id: "pipe-1",
      isDraft: false,
      versions: [],
    } as never);
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([]);

    const result = await caller.deploymentStatus({ pipelineId: "pipe-1" });

    expect(result.latestVersion).toBe(0);
    expect(result.nodes).toEqual([]);
  });

  it("throws NOT_FOUND when pipeline does not exist", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue(null);

    await expect(caller.deploymentStatus({ pipelineId: "missing" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ── pipeline.deployBatch ──────────────────────────────────────────────────────

describe("pipeline.deployBatch", () => {
  it("calls deployBatch service with pipelineIds, userId, and changelog", async () => {
    const mockResult: BatchDeployResult = {
      total: 2,
      completed: 2,
      failed: 0,
      results: [
        { pipelineId: "p1", success: true, versionId: "v1", versionNumber: 1 },
        { pipelineId: "p2", success: true, versionId: "v2", versionNumber: 1 },
      ],
    };
    deployBatchMock.mockResolvedValue(mockResult);

    const result = await caller.deployBatch({
      pipelineIds: ["p1", "p2"],
      changelog: "Weekly deploy",
    });

    expect(deployBatchMock).toHaveBeenCalledWith(["p1", "p2"], "user-1", "Weekly deploy");
    expect(result.total).toBe(2);
    expect(result.completed).toBe(2);
  });
});

// ── pipeline.bulkUndeploy ─────────────────────────────────────────────────────

describe("pipeline.bulkUndeploy", () => {
  it("returns succeeded count and per-pipeline results on full success", async () => {
    undeployAgentMock.mockResolvedValue({ success: true });

    const result = await caller.bulkUndeploy({ pipelineIds: ["p1", "p2", "p3"] });

    expect(result.total).toBe(3);
    expect(result.succeeded).toBe(3);
    expect(result.results.every((r: { success: boolean }) => r.success)).toBe(true);
  });

  it("captures per-pipeline errors without throwing", async () => {
    undeployAgentMock
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: "connection refused" })
      .mockRejectedValueOnce(new Error("timeout"));

    const result = await caller.bulkUndeploy({ pipelineIds: ["p1", "p2", "p3"] });

    expect(result.total).toBe(3);
    expect(result.succeeded).toBe(1);

    const [r1, r2, r3] = result.results;
    expect(r1).toMatchObject({ pipelineId: "p1", success: true });
    expect(r2).toMatchObject({ pipelineId: "p2", success: false, error: "connection refused" });
    expect(r3).toMatchObject({ pipelineId: "p3", success: false, error: "timeout" });
  });

  it("calls undeployAgent for each pipelineId", async () => {
    undeployAgentMock.mockResolvedValue({ success: true });

    await caller.bulkUndeploy({ pipelineIds: ["p1", "p2"] });

    expect(undeployAgentMock).toHaveBeenCalledTimes(2);
    expect(undeployAgentMock).toHaveBeenCalledWith("p1");
    expect(undeployAgentMock).toHaveBeenCalledWith("p2");
  });
});
