/**
 * Dashboard router — unit tests for core procedures:
 *   stats, recentPipelines, recentAudit, listViews, createView, deleteView
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
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) =>
      next({ ctx }),
    );
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
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) =>
      next({ ctx }),
    ),
}));

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

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

vi.mock("@/server/services/dashboard-data", () => ({
  computeChartMetrics: vi.fn(() => ({})),
  assembleNodeCards: vi.fn(() => []),
  assemblePipelineCards: vi.fn(() => []),
  computeFleetHotness: vi.fn(() => ({ averages: { cpuPct: 0, memoryPct: 0 }, nodes: [], series: { cpu: [], memory: [] } })),
}));

vi.mock("@/server/services/metrics-query", () => ({
  queryVolumeTimeSeries: vi.fn(async () => []),
  queryNodeMetricsAggregated: vi.fn(async () => ({ rows: [] })),
  resolveMetricsSource: vi.fn(() => "raw"),
}));

import { prisma } from "@/lib/prisma";
import { dashboardRouter } from "@/server/routers/dashboard";
import { computeFleetHotness } from "@/server/services/dashboard-data";
import { queryNodeMetricsAggregated } from "@/server/services/metrics-query";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(dashboardRouter)({
  session: { user: { id: "user-1" } },
  organizationId: "org-1",
});

beforeEach(() => {
  mockReset(prismaMock);
  vi.clearAllMocks();
});

// ── dashboard.stats ────────────────────────────────────────────────────────────

describe("dashboard.stats", () => {
  it("returns combined stats with correct shape", async () => {
    prismaMock.pipeline.count.mockResolvedValue(5);
    prismaMock.vectorNode.count.mockResolvedValue(3);
    // @ts-expect-error - groupBy mock typing is complex
    prismaMock.vectorNode.groupBy.mockResolvedValue([
      { status: "HEALTHY", _count: { status: 2 } },
      { status: "DEGRADED", _count: { status: 1 } },
    ] as never);
    prismaMock.pipelineMetric.aggregate.mockResolvedValue({
      _sum: { eventsIn: BigInt(1000), eventsOut: BigInt(800) },
    } as never);
    prismaMock.alertEvent.count.mockResolvedValue(2);
    prismaMock.anomalyEvent.count.mockResolvedValue(1);

    const result = await caller.stats({ environmentId: "env-1" });

    expect(result.pipelines).toBe(5);
    expect(result.nodes).toBe(3);
    expect(result.fleet.healthy).toBe(2);
    expect(result.fleet.degraded).toBe(1);
    expect(result.fleet.unreachable).toBe(0);
    expect(result.alerts).toBe(3); // firingAlertCount + openAnomalyCount
  });

  it("reports deployed and draft-inclusive pipeline counts separately", async () => {
    // The deployed-only count filters isDraft:false; the draft-inclusive total
    // does not. Distinguish the two calls by their where clause.
    prismaMock.pipeline.count.mockImplementation(
      ((args?: { where?: { isDraft?: boolean } }) =>
        Promise.resolve(args?.where?.isDraft === false ? 2 : 7)) as never,
    );
    prismaMock.vectorNode.count.mockResolvedValue(0);
    // @ts-expect-error - groupBy mock typing is complex
    prismaMock.vectorNode.groupBy.mockResolvedValue([]);
    prismaMock.pipelineMetric.aggregate.mockResolvedValue({
      _sum: { eventsIn: BigInt(0), eventsOut: BigInt(0) },
    } as never);
    prismaMock.alertEvent.count.mockResolvedValue(0);
    prismaMock.anomalyEvent.count.mockResolvedValue(0);

    const result = await caller.stats({ environmentId: "env-1" });

    expect(result.pipelines).toBe(2); // deployed only
    expect(result.pipelinesTotal).toBe(7); // includes drafts
  });

  it("returns reductionPercent=null when eventsIn is 0", async () => {
    prismaMock.pipeline.count.mockResolvedValue(0);
    prismaMock.vectorNode.count.mockResolvedValue(0);
    // @ts-expect-error - groupBy mock typing is complex
    prismaMock.vectorNode.groupBy.mockResolvedValue([]);
    prismaMock.pipelineMetric.aggregate.mockResolvedValue({
      _sum: { eventsIn: BigInt(0), eventsOut: BigInt(0) },
    } as never);
    prismaMock.alertEvent.count.mockResolvedValue(0);
    prismaMock.anomalyEvent.count.mockResolvedValue(0);

    const result = await caller.stats({ environmentId: "env-1" });

    expect(result.reduction.percent).toBeNull();
    expect(result.reduction.eventsIn).toBe(0);
    expect(result.reduction.eventsOut).toBe(0);
  });

  it("calculates reduction percent correctly when eventsIn > 0", async () => {
    prismaMock.pipeline.count.mockResolvedValue(1);
    prismaMock.vectorNode.count.mockResolvedValue(1);
    // @ts-expect-error - groupBy mock typing is complex
    prismaMock.vectorNode.groupBy.mockResolvedValue([]);
    prismaMock.pipelineMetric.aggregate.mockResolvedValue({
      _sum: { eventsIn: BigInt(1000), eventsOut: BigInt(500) },
    } as never);
    prismaMock.alertEvent.count.mockResolvedValue(0);
    prismaMock.anomalyEvent.count.mockResolvedValue(0);

    const result = await caller.stats({ environmentId: "env-1" });

    expect(result.reduction.percent).toBe(50);
  });

  it("returns 0 for unreachable when no UNREACHABLE nodes exist", async () => {
    prismaMock.pipeline.count.mockResolvedValue(0);
    prismaMock.vectorNode.count.mockResolvedValue(2);
    // @ts-expect-error - groupBy mock typing is complex
    prismaMock.vectorNode.groupBy.mockResolvedValue([
      { status: "HEALTHY", _count: { status: 2 } },
    ] as never);
    prismaMock.pipelineMetric.aggregate.mockResolvedValue({
      _sum: { eventsIn: null, eventsOut: null },
    } as never);
    prismaMock.alertEvent.count.mockResolvedValue(0);
    prismaMock.anomalyEvent.count.mockResolvedValue(0);

    const result = await caller.stats({ environmentId: "env-1" });

    expect(result.fleet.unreachable).toBe(0);
  });
});

// ── dashboard.recentPipelines ──────────────────────────────────────────────────

describe("dashboard.recentPipelines", () => {
  it("returns up to 5 recently updated pipelines for a regular user", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue(null);

    const pipelines = Array.from({ length: 3 }, (_, i) => ({
      id: `pipe-${i}`,
      name: `Pipeline ${i}`,
      updatedAt: new Date(),
      environment: { name: "Production" },
    }));
    prismaMock.pipeline.findMany.mockResolvedValue(pipelines as never);

    const result = await caller.recentPipelines();

    expect(result).toHaveLength(3);
    expect(result[0]).toHaveProperty("environment");
  });

  it("fetches with no teamFilter for super admin", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue({ role: "OWNER" } as never);
    prismaMock.pipeline.findMany.mockResolvedValue([]);

    await caller.recentPipelines();

    expect(prismaMock.pipeline.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1" },
        take: 5,
        orderBy: { updatedAt: "desc" },
      }),
    );
  });

  it("applies team membership filter for non-super-admin", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue(null);
    prismaMock.pipeline.findMany.mockResolvedValue([]);

    await caller.recentPipelines();

    expect(prismaMock.pipeline.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          environment: expect.objectContaining({
            team: expect.objectContaining({ members: expect.anything() }),
          }),
        }),
        take: 5,
      }),
    );
  });
});

// ── dashboard.recentAudit ──────────────────────────────────────────────────────

describe("dashboard.recentAudit", () => {
  it("returns up to 10 recent audit entries", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue(null);
    prismaMock.teamMember.findMany.mockResolvedValue([{ teamId: "team-1" }] as never);

    const logs = Array.from({ length: 4 }, (_, i) => ({
      id: `log-${i}`,
      action: "pipeline.create",
      createdAt: new Date(),
      user: { name: "Alice", email: "alice@example.com" },
    }));
    prismaMock.auditLog.findMany.mockResolvedValue(logs as never);

    const result = await caller.recentAudit();

    expect(result).toHaveLength(4);
  });

  it("applies no teamId filter for super admin", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue({ role: "OWNER" } as never);
    prismaMock.auditLog.findMany.mockResolvedValue([]);

    await caller.recentAudit();

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1" },
        take: 10,
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  it("applies teamId filter for non-super-admin", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue(null);
    prismaMock.teamMember.findMany.mockResolvedValue([
      { teamId: "team-1" },
      { teamId: "team-2" },
    ] as never);
    prismaMock.auditLog.findMany.mockResolvedValue([]);

    await caller.recentAudit();

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1", teamId: { in: ["team-1", "team-2"] } },
      }),
    );
  });
});

// ── dashboard.listViews ────────────────────────────────────────────────────────

describe("dashboard.listViews", () => {
  it("returns views for the current user ordered by sortOrder", async () => {
    const views = [
      {
        id: "view-1",
        userId: "user-1",
        name: "My View",
        panels: ["pipeline-volume"],
        filters: {},
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    prismaMock.dashboardView.findMany.mockResolvedValue(views as never);

    const result = await caller.listViews();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "view-1", name: "My View" });
  });

  it("queries only for the current user with sortOrder asc", async () => {
    prismaMock.dashboardView.findMany.mockResolvedValue([]);

    await caller.listViews();

    expect(prismaMock.dashboardView.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        orderBy: { sortOrder: "asc" },
      }),
    );
  });

  it("returns empty array when user has no views", async () => {
    prismaMock.dashboardView.findMany.mockResolvedValue([]);

    const result = await caller.listViews();

    expect(result).toEqual([]);
  });
});

// ── dashboard.createView ───────────────────────────────────────────────────────

describe("dashboard.createView", () => {
  it("creates a view with sortOrder 0 when no existing views", async () => {
    prismaMock.dashboardView.aggregate.mockResolvedValue({
      _max: { sortOrder: null },
    } as never);

    const created = {
      id: "view-new",
      userId: "user-1",
      name: "New View",
      panels: ["pipeline-volume"],
      filters: {},
      sortOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prismaMock.dashboardView.create.mockResolvedValue(created as never);

    const result = await caller.createView({
      environmentId: "env-1",
      name: "New View",
      panels: ["pipeline-volume"],
    });

    expect(result).toMatchObject({ id: "view-new", name: "New View" });
    expect(prismaMock.dashboardView.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          name: "New View",
          sortOrder: 0,
        }),
      }),
    );
  });

  it("increments sortOrder based on current max", async () => {
    prismaMock.dashboardView.aggregate.mockResolvedValue({
      _max: { sortOrder: 2 },
    } as never);

    const created = {
      id: "view-next",
      userId: "user-1",
      name: "Another View",
      panels: ["fleet-nodes"],
      filters: {},
      sortOrder: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prismaMock.dashboardView.create.mockResolvedValue(created as never);

    await caller.createView({
      environmentId: "env-1",
      name: "Another View",
      panels: ["fleet-nodes"],
    });

    expect(prismaMock.dashboardView.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sortOrder: 3 }),
      }),
    );
  });
});

// ── dashboard.deleteView ───────────────────────────────────────────────────────

describe("dashboard.deleteView", () => {
  it("deletes the view when it belongs to the current user", async () => {
    prismaMock.dashboardView.findUnique.mockResolvedValue({
      id: "view-1",
      userId: "user-1",
    } as never);
    prismaMock.dashboardView.delete.mockResolvedValue({} as never);

    const result = await caller.deleteView({ environmentId: "env-1", id: "view-1" });

    expect(prismaMock.dashboardView.delete).toHaveBeenCalledWith({
      where: { id: "view-1" },
    });
    expect(result).toEqual({ deleted: true });
  });

  it("throws NOT_FOUND when view does not exist", async () => {
    prismaMock.dashboardView.findUnique.mockResolvedValue(null);

    await expect(
      caller.deleteView({ environmentId: "env-1", id: "missing-view" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(prismaMock.dashboardView.delete).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when view belongs to a different user", async () => {
    prismaMock.dashboardView.findUnique.mockResolvedValue({
      id: "view-1",
      userId: "user-other",
    } as never);

    await expect(
      caller.deleteView({ environmentId: "env-1", id: "view-1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(prismaMock.dashboardView.delete).not.toHaveBeenCalled();
  });
});

// ── dashboard.fleetHotness ────────────────────────────────────────────────────

describe("dashboard.fleetHotness", () => {
  it("loads environment nodes for the selected range and computes hotness", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([
      { id: "node-1", name: "Node 1" },
      { id: "node-2", name: "Node 2" },
    ] as never);
    (queryNodeMetricsAggregated as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{ nodeId: "node-1", timestamp: new Date("2025-01-01T00:00:00Z") }],
    });
    (computeFleetHotness as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      averages: { cpuPct: 42, memoryPct: 64 },
      nodes: [{ nodeId: "node-1", nodeName: "Node 1", cpuPct: 42, memoryPct: 64, hotness: 64 }],
      series: { cpu: [42], memory: [64] },
    });

    const result = await caller.fleetHotness({ environmentId: "env-1", range: "6h" });

    expect(prismaMock.vectorNode.findMany).toHaveBeenCalledWith({
      where: { environment: { id: "env-1" } },
      select: { id: true, name: true },
    });
    expect(queryNodeMetricsAggregated).toHaveBeenCalledWith({
      nodeIds: ["node-1", "node-2"],
      minutes: 360,
    });
    expect(computeFleetHotness).toHaveBeenCalledWith({
      nodeNameMap: new Map([
        ["node-1", "Node 1"],
        ["node-2", "Node 2"],
      ]),
      nodeRows: [{ nodeId: "node-1", timestamp: new Date("2025-01-01T00:00:00Z") }],
    });
    expect(result.averages.memoryPct).toBe(64);
  });
});

// ── dashboard.pipelineCards ────────────────────────────────────────────────────

describe("dashboard.pipelineCards", () => {
  beforeEach(() => {
    prismaMock.orgMember.findUnique.mockResolvedValue({ role: "OWNER" } as never);
  });

  it("returns an empty array when the environment is unknown (stale id)", async () => {
    // pipelineCards now uses environment.findFirst with org-scoping
    // (PR #380 P1) so cross-org reads also surface as null here.
    prismaMock.environment.findFirst.mockResolvedValue(null);

    const result = await caller.pipelineCards({ environmentId: "env-missing" });

    expect(result).toEqual([]);
    expect(prismaMock.pipeline.findMany).not.toHaveBeenCalled();
  });

  it("forbids non-member access when the environment belongs to another team (same org)", async () => {
    prismaMock.environment.findFirst.mockResolvedValue({
      id: "env-1",
      teamId: "team-other",
      organizationId: "org-1",
    } as never);
    prismaMock.orgMember.findUnique.mockResolvedValue(null);
    prismaMock.teamMember.findUnique.mockResolvedValue(null);

    await expect(
      caller.pipelineCards({ environmentId: "env-1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
