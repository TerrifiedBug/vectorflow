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

vi.mock("@/server/services/push-registry", () => ({
  pushRegistry: { isConnected: vi.fn(() => false), notify: vi.fn() },
}));

vi.mock("@/server/services/version-check", () => ({
  checkDevAgentVersion: vi.fn(),
}));

vi.mock("@/server/services/fleet-data", () => ({
  getFleetOverview: vi.fn(),
  getVolumeTrend: vi.fn(),
  getNodeThroughput: vi.fn(),
  getNodeCapacity: vi.fn(),
  getDataLoss: vi.fn(),
  getMatrixThroughput: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { fleetRouter } from "@/server/routers/fleet";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(fleetRouter)({
  session: { user: { id: "user-1" } },
});

describe("fleet.matrixSummary — scale test", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("handles 200 pipelines x 10 nodes within 500ms", async () => {
    const PIPELINE_COUNT = 200;
    const NODE_COUNT = 10;

    // Build 10 nodes each with 200 pipeline statuses (versions nested in pipeline)
    const nodes = Array.from({ length: NODE_COUNT }, (_, nodeIdx) => ({
      id: `node-${nodeIdx}`,
      name: `node-${nodeIdx}`,
      host: `10.0.0.${nodeIdx}`,
      apiPort: 8686,
      status: "HEALTHY",
      maintenanceMode: false,
      labels: {},
      pipelineStatuses: Array.from({ length: PIPELINE_COUNT }, (_, pipeIdx) => ({
        pipelineId: `pipe-${pipeIdx}`,
        status: pipeIdx % 20 === 0 ? "CRASHED" : "RUNNING",
        version: pipeIdx % 10 === 0 ? 1 : 2,
        pipeline: { id: `pipe-${pipeIdx}`, name: `pipeline-${pipeIdx}`, versions: [{ version: 2 }] },
      })),
    }));

    prismaMock.vectorNode.findMany.mockResolvedValueOnce(nodes as never);

    const start = performance.now();
    const result = await caller.matrixSummary({ environmentId: "env-1" });
    const elapsed = performance.now() - start;

    expect(result).toHaveLength(NODE_COUNT);
    expect(elapsed).toBeLessThan(500);

    // Verify aggregates for first node
    const firstNode = result[0];
    expect(firstNode.pipelineCount).toBe(PIPELINE_COUNT);
    // Crashed: every 20th pipeline (indices 0, 20, 40, ...) = 10 pipelines
    expect(firstNode.errorCount).toBe(PIPELINE_COUNT / 20);
    // Version drift: every 10th pipeline has version 1 but latest is 2 = 20 pipelines
    expect(firstNode.versionDriftCount).toBe(PIPELINE_COUNT / 10);
  });
});
