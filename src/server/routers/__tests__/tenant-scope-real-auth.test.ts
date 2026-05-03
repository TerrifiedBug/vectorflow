import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { testT } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  return { testT: initTRPC.context().create() };
});

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/metric-store", () => ({
  metricStore: {
    getLatestAll: vi.fn(() => new Map()),
    getAllForPipeline: vi.fn(() => new Map()),
    getAllForNode: vi.fn(() => new Map()),
    getSamples: vi.fn(() => []),
    getStreamCount: vi.fn(() => 0),
    getEstimatedMemoryBytes: vi.fn(() => 0),
  },
}));

vi.mock("@/server/services/metrics-query", () => ({
  queryPipelineMetricsAggregated: vi.fn(async () => []),
  queryVolumeTimeSeries: vi.fn(async () => []),
  queryNodeMetricsAggregated: vi.fn(async () => ({ rows: [] })),
  resolveMetricsSource: vi.fn(() => "raw"),
}));

vi.mock("@/server/services/dashboard-data", () => ({
  computeChartMetrics: vi.fn(() => ({})),
  assembleNodeCards: vi.fn(() => []),
  assemblePipelineCards: vi.fn(() => []),
}));

const mockDeployBatch = vi.fn();
vi.mock("@/server/services/deploy-agent", () => ({
  deployAgent: vi.fn(),
  undeployAgent: vi.fn(async () => ({ success: true })),
  deployBatch: (...args: unknown[]) => mockDeployBatch(...args),
}));

vi.mock("@/server/middleware/audit", () => ({
  withAudit: () =>
    testT.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) =>
      next({ ctx }),
    ),
}));

import { prisma } from "@/lib/prisma";
import { metricsRouter } from "@/server/routers/metrics";
import { dashboardRouter } from "@/server/routers/dashboard";
import { auditRouter } from "@/server/routers/audit";
import { pipelineRouter } from "@/server/routers/pipeline";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const testContext = { session: { user: { id: "user-1" } }, ipAddress: null };
const metricsCaller = metricsRouter.createCaller(testContext);
const dashboardCaller = dashboardRouter.createCaller(testContext);
const auditCaller = auditRouter.createCaller(testContext);
const pipelineCaller = pipelineRouter.createCaller(testContext);

beforeEach(() => {
  mockReset(prismaMock);
  vi.clearAllMocks();
});

describe("tenant scoping with real authorization middleware", () => {
  it("blocks pipeline metrics reads for pipelines outside the caller's teams", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({
      environment: { teamId: "team-2" },
    } as never);
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: false } as never);
    prismaMock.teamMember.findUnique.mockResolvedValue(null);

    await expect(
      metricsCaller.getPipelineMetrics({ pipelineId: "pipe-team-2" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks component metrics reads for pipelines outside the caller's teams", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({
      environment: { teamId: "team-2" },
    } as never);
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: false } as never);
    prismaMock.teamMember.findUnique.mockResolvedValue(null);

    await expect(
      metricsCaller.getComponentMetrics({ pipelineId: "pipe-team-2" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks node pipeline rate reads for nodes outside the caller's teams", async () => {
    prismaMock.vectorNode.findUnique.mockResolvedValue({
      environment: { teamId: "team-2" },
    } as never);
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: false } as never);
    prismaMock.teamMember.findUnique.mockResolvedValue(null);

    await expect(
      metricsCaller.getNodePipelineRates({ nodeId: "node-team-2" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks dashboard pipeline cards for environments outside the caller's teams", async () => {
    prismaMock.environment.findUnique.mockResolvedValue({ teamId: "team-2" } as never);
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: false } as never);
    prismaMock.teamMember.findUnique.mockResolvedValue(null);

    await expect(
      dashboardCaller.pipelineCards({ environmentId: "env-team-2" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("narrows audit list results to the caller's team memberships", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: false } as never);
    prismaMock.teamMember.findMany.mockResolvedValue([{ teamId: "team-1" }] as never);
    prismaMock.auditLog.findMany.mockResolvedValue([]);

    await auditCaller.list({});

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                { teamId: { in: ["team-1"] } },
                { environment: { teamId: { in: ["team-1"] } } },
              ]),
            }),
          ]),
        }),
      }),
    );
  });

  it("rejects mixed-team pipeline batches before deploy mutation side effects", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({
      environment: { teamId: "team-1" },
    } as never);
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: false } as never);
    prismaMock.teamMember.findUnique.mockResolvedValue({ role: "EDITOR" } as never);
    prismaMock.pipeline.findMany.mockResolvedValue([
      { id: "pipe-1", environment: { teamId: "team-1" } },
      { id: "pipe-2", environment: { teamId: "team-2" } },
    ] as never);

    await expect(
      pipelineCaller.deployBatch({
        pipelineIds: ["pipe-1", "pipe-2"],
        changelog: "deploy together",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(mockDeployBatch).not.toHaveBeenCalled();
  });
});
