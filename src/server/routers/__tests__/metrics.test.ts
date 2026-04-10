/**
 * Metrics router — unit tests for procedures:
 *   getPipelineMetrics, getComponentLatencyHistory, getComponentMetrics,
 *   getNodePipelineRates, getLiveRates
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
    middleware: t.middleware,
  };
});

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

import { prisma } from "@/lib/prisma";
import { metricStore } from "@/server/services/metric-store";
import { queryPipelineMetricsAggregated } from "@/server/services/metrics-query";
import { metricsRouter } from "@/server/routers/metrics";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(metricsRouter)({
  session: { user: { id: "user-1" } },
});

beforeEach(() => {
  mockReset(prismaMock);
  vi.clearAllMocks();
});

// ── metrics.getPipelineMetrics ─────────────────────────────────────────────────

describe("metrics.getPipelineMetrics", () => {
  it("delegates to queryPipelineMetricsAggregated with correct params", async () => {
    const mockRows = [
      {
        timestamp: new Date(),
        eventsIn: BigInt(100),
        eventsOut: BigInt(80),
        eventsDiscarded: BigInt(0),
        errorsTotal: BigInt(0),
        bytesIn: BigInt(1024),
        bytesOut: BigInt(820),
        utilization: 0.5,
        latencyMeanMs: 2.5,
      },
    ];
    (queryPipelineMetricsAggregated as ReturnType<typeof vi.fn>).mockResolvedValue(mockRows);

    const result = await caller.getPipelineMetrics({ pipelineId: "pipe-1", minutes: 30 });

    expect(queryPipelineMetricsAggregated).toHaveBeenCalledWith({
      pipelineId: "pipe-1",
      minutes: 30,
    });
    expect(result).toEqual(mockRows);
  });

  it("uses default minutes=60 when not specified", async () => {
    (queryPipelineMetricsAggregated as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await caller.getPipelineMetrics({ pipelineId: "pipe-1" });

    expect(queryPipelineMetricsAggregated).toHaveBeenCalledWith({
      pipelineId: "pipe-1",
      minutes: 60,
    });
  });

  it("returns empty array when no metrics exist", async () => {
    (queryPipelineMetricsAggregated as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await caller.getPipelineMetrics({ pipelineId: "pipe-1" });

    expect(result).toEqual([]);
  });
});

// ── metrics.getComponentLatencyHistory ────────────────────────────────────────

describe("metrics.getComponentLatencyHistory", () => {
  it("returns components map with averaged latency per timestamp", async () => {
    const now = new Date("2024-01-01T12:00:00Z");
    const rows = [
      { componentId: "comp-1", timestamp: now, latencyMeanMs: 4 },
      { componentId: "comp-1", timestamp: now, latencyMeanMs: 6 },
      { componentId: "comp-2", timestamp: now, latencyMeanMs: 10 },
    ];
    prismaMock.pipelineMetric.findMany.mockResolvedValue(rows as never);

    const result = await caller.getComponentLatencyHistory({ pipelineId: "pipe-1" });

    // comp-1: average of 4 and 6 = 5
    expect(result.components["comp-1"]).toHaveLength(1);
    expect(result.components["comp-1"][0].latencyMeanMs).toBe(5);
    // comp-2: single value 10
    expect(result.components["comp-2"][0].latencyMeanMs).toBe(10);
  });

  it("returns empty components when no rows exist", async () => {
    prismaMock.pipelineMetric.findMany.mockResolvedValue([]);

    const result = await caller.getComponentLatencyHistory({ pipelineId: "pipe-1" });

    expect(result.components).toEqual({});
  });

  it("skips rows with null latencyMeanMs", async () => {
    const now = new Date();
    const rows = [
      { componentId: "comp-1", timestamp: now, latencyMeanMs: null },
      { componentId: "comp-1", timestamp: now, latencyMeanMs: 8 },
    ];
    prismaMock.pipelineMetric.findMany.mockResolvedValue(rows as never);

    const result = await caller.getComponentLatencyHistory({ pipelineId: "pipe-1" });

    // Only the row with latencyMeanMs=8 is counted
    expect(result.components["comp-1"][0].latencyMeanMs).toBe(8);
  });

  it("queries only rows with non-null componentId within the time range", async () => {
    prismaMock.pipelineMetric.findMany.mockResolvedValue([]);

    await caller.getComponentLatencyHistory({ pipelineId: "pipe-1", minutes: 30 });

    expect(prismaMock.pipelineMetric.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          pipelineId: "pipe-1",
          componentId: { not: null },
          timestamp: { gte: expect.any(Date) },
        }),
      }),
    );
  });
});

// ── metrics.getComponentMetrics ────────────────────────────────────────────────

describe("metrics.getComponentMetrics", () => {
  it("returns empty components when pipeline does not exist", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue(null);

    const result = await caller.getComponentMetrics({ pipelineId: "missing-pipe" });

    expect(result.components).toEqual({});
  });

  it("returns components from metricStore for each vector node", async () => {
    const pipeline = {
      id: "pipe-1",
      nodes: [
        {
          id: "pn-1",
          componentKey: "source-0",
          displayName: "HTTP Source",
          componentType: "http",
          kind: "SOURCE",
        },
      ],
      environment: {
        nodes: [{ id: "vnode-1" }],
      },
    };
    prismaMock.pipeline.findUnique.mockResolvedValue(pipeline as never);

    const sampleData = [
      {
        timestamp: Date.now(),
        receivedEventsRate: 10,
        sentEventsRate: 10,
        receivedBytesRate: 1024,
        sentBytesRate: 1024,
        errorCount: 0,
        errorsRate: 0,
        discardedRate: 0,
        latencyMeanMs: null,
      },
    ];

    (metricStore.getAllForPipeline as ReturnType<typeof vi.fn>).mockReturnValue(
      new Map([["source-0", sampleData]]),
    );

    const result = await caller.getComponentMetrics({ pipelineId: "pipe-1" });

    expect(Object.keys(result.components)).toContain("source-0");
    expect(result.components["source-0"].kind).toBe("SOURCE");
    expect(result.components["source-0"].samples).toEqual(sampleData);
  });

  it("only includes components that have a matching pipeline node", async () => {
    const pipeline = {
      id: "pipe-1",
      nodes: [
        {
          id: "pn-1",
          componentKey: "source-0",
          displayName: null,
          componentType: "http",
          kind: "SOURCE",
        },
      ],
      environment: { nodes: [{ id: "vnode-1" }] },
    };
    prismaMock.pipeline.findUnique.mockResolvedValue(pipeline as never);

    // metricStore returns both a matching and a non-matching component
    (metricStore.getAllForPipeline as ReturnType<typeof vi.fn>).mockReturnValue(
      new Map([
        ["source-0", [{ timestamp: Date.now(), receivedEventsRate: 5 }]],
        ["unknown-component", [{ timestamp: Date.now(), receivedEventsRate: 3 }]],
      ]),
    );

    const result = await caller.getComponentMetrics({ pipelineId: "pipe-1" });

    expect(Object.keys(result.components)).toContain("source-0");
    expect(Object.keys(result.components)).not.toContain("unknown-component");
  });
});

// ── metrics.getNodePipelineRates ───────────────────────────────────────────────

describe("metrics.getNodePipelineRates", () => {
  beforeEach(() => {
    prismaMock.vectorNode.findUnique.mockResolvedValue({ environmentId: "env-1" } as never);
  });

  it("returns empty rates when metricStore has no data for node", async () => {
    (metricStore.getAllForNode as ReturnType<typeof vi.fn>).mockReturnValue(new Map());
    prismaMock.pipelineNode.findMany.mockResolvedValue([]);

    const result = await caller.getNodePipelineRates({ nodeId: "vnode-1" });

    expect(result.rates).toEqual({});
  });

  it("accumulates SOURCE eventsInRate and SINK eventsOutRate per pipeline", async () => {
    const sourceSample = {
      timestamp: Date.now(),
      receivedEventsRate: 100,
      sentEventsRate: 0,
      receivedBytesRate: 1024,
      sentBytesRate: 0,
      errorCount: 0,
      errorsRate: 0,
      discardedRate: 0,
      latencyMeanMs: null,
    };
    const sinkSample = {
      timestamp: Date.now(),
      receivedEventsRate: 0,
      sentEventsRate: 90,
      receivedBytesRate: 0,
      sentBytesRate: 900,
      errorCount: 0,
      errorsRate: 0,
      discardedRate: 0,
      latencyMeanMs: null,
    };

    (metricStore.getAllForNode as ReturnType<typeof vi.fn>).mockReturnValue(
      new Map([
        ["source-key", [sourceSample]],
        ["sink-key", [sinkSample]],
      ]),
    );

    prismaMock.pipelineNode.findMany.mockResolvedValue([
      { pipelineId: "pipe-1", componentKey: "source-key", displayName: "Source", kind: "SOURCE" },
      { pipelineId: "pipe-1", componentKey: "sink-key", displayName: "Sink", kind: "SINK" },
    ] as never);

    const result = await caller.getNodePipelineRates({ nodeId: "vnode-1" });

    expect(result.rates["pipe-1"]).toMatchObject({
      eventsInRate: 100,
      eventsOutRate: 90,
      bytesInRate: 1024,
      bytesOutRate: 900,
    });
  });

  it("skips components with no samples", async () => {
    (metricStore.getAllForNode as ReturnType<typeof vi.fn>).mockReturnValue(
      new Map([["source-key", []]]),
    );

    prismaMock.pipelineNode.findMany.mockResolvedValue([
      { pipelineId: "pipe-1", componentKey: "source-key", displayName: null, kind: "SOURCE" },
    ] as never);

    const result = await caller.getNodePipelineRates({ nodeId: "vnode-1" });

    // Empty samples → skipped → no rate entry
    expect(result.rates).toEqual({});
  });

  it("skips components that don't match any pipeline node", async () => {
    const sample = {
      timestamp: Date.now(),
      receivedEventsRate: 50,
      sentEventsRate: 0,
      receivedBytesRate: 512,
      sentBytesRate: 0,
      errorCount: 0,
      errorsRate: 0,
      discardedRate: 0,
      latencyMeanMs: null,
    };

    (metricStore.getAllForNode as ReturnType<typeof vi.fn>).mockReturnValue(
      new Map([["orphan-key", [sample]]]),
    );

    prismaMock.pipelineNode.findMany.mockResolvedValue([
      { pipelineId: "pipe-1", componentKey: "source-key", displayName: null, kind: "SOURCE" },
    ] as never);

    const result = await caller.getNodePipelineRates({ nodeId: "vnode-1" });

    expect(result.rates).toEqual({});
  });

  it("computes averaged latency across components for a pipeline", async () => {
    const sample1 = {
      timestamp: Date.now(),
      receivedEventsRate: 10,
      sentEventsRate: 0,
      receivedBytesRate: 0,
      sentBytesRate: 0,
      errorCount: 0,
      errorsRate: 0,
      discardedRate: 0,
      latencyMeanMs: 4,
    };
    const sample2 = {
      timestamp: Date.now(),
      receivedEventsRate: 0,
      sentEventsRate: 0,
      receivedBytesRate: 0,
      sentBytesRate: 0,
      errorCount: 0,
      errorsRate: 2,
      discardedRate: 0,
      latencyMeanMs: 6,
    };

    (metricStore.getAllForNode as ReturnType<typeof vi.fn>).mockReturnValue(
      new Map([
        ["source-key", [sample1]],
        ["transform-key", [sample2]],
      ]),
    );

    prismaMock.pipelineNode.findMany.mockResolvedValue([
      { pipelineId: "pipe-1", componentKey: "source-key", displayName: null, kind: "SOURCE" },
      { pipelineId: "pipe-1", componentKey: "transform-key", displayName: null, kind: "TRANSFORM" },
    ] as never);

    const result = await caller.getNodePipelineRates({ nodeId: "vnode-1" });

    // Average of latency 4 and 6 = 5
    expect(result.rates["pipe-1"].latencyMeanMs).toBe(5);
  });
});

// ── metrics.getLiveRates ────────────────────────────────────────────────────────

describe("metrics.getLiveRates", () => {
  it("returns rates for each pipeline keyed by pipelineId", async () => {
    prismaMock.pipeline.findMany.mockResolvedValue([
      {
        id: "pipe-1",
        nodes: [
          { componentKey: "source-key", kind: "SOURCE" },
          { componentKey: "sink-key", kind: "SINK" },
        ],
      },
    ] as never);

    prismaMock.vectorNode.findMany.mockResolvedValue([
      { id: "vnode-1" },
    ] as never);

    const sample = {
      timestamp: Date.now(),
      receivedEventsRate: 50,
      sentEventsRate: 45,
      receivedBytesRate: 5120,
      sentBytesRate: 4608,
      errorCount: 0,
      errorsRate: 0,
      discardedRate: 0,
      latencyMeanMs: null,
    };

    (metricStore.getAllForPipeline as ReturnType<typeof vi.fn>).mockReturnValue(
      new Map([["source-key", [sample]]]),
    );

    const result = await caller.getLiveRates({ environmentId: "env-1" });

    expect(result.rates["pipe-1"]).toMatchObject({
      eventsPerSec: 50,
      bytesPerSec: 5120,
    });
  });

  it("returns zero rates for pipeline with no metrics in the store", async () => {
    prismaMock.pipeline.findMany.mockResolvedValue([
      {
        id: "pipe-1",
        nodes: [{ componentKey: "source-key", kind: "SOURCE" }],
      },
    ] as never);

    prismaMock.vectorNode.findMany.mockResolvedValue([{ id: "vnode-1" }] as never);

    (metricStore.getAllForPipeline as ReturnType<typeof vi.fn>).mockReturnValue(new Map());

    const result = await caller.getLiveRates({ environmentId: "env-1" });

    expect(result.rates["pipe-1"]).toEqual({ eventsPerSec: 0, bytesPerSec: 0 });
  });

  it("only counts SOURCE component rates — ignores SINK", async () => {
    prismaMock.pipeline.findMany.mockResolvedValue([
      {
        id: "pipe-1",
        nodes: [
          { componentKey: "source-key", kind: "SOURCE" },
          { componentKey: "sink-key", kind: "SINK" },
        ],
      },
    ] as never);

    prismaMock.vectorNode.findMany.mockResolvedValue([{ id: "vnode-1" }] as never);

    const sourceSample = {
      timestamp: Date.now(),
      receivedEventsRate: 20,
      receivedBytesRate: 2048,
      sentEventsRate: 0,
      sentBytesRate: 0,
      errorCount: 0,
      errorsRate: 0,
      discardedRate: 0,
      latencyMeanMs: null,
    };
    const sinkSample = {
      timestamp: Date.now(),
      receivedEventsRate: 0,
      receivedBytesRate: 0,
      sentEventsRate: 18,
      sentBytesRate: 1800,
      errorCount: 0,
      errorsRate: 0,
      discardedRate: 0,
      latencyMeanMs: null,
    };

    (metricStore.getAllForPipeline as ReturnType<typeof vi.fn>).mockReturnValue(
      new Map([
        ["source-key", [sourceSample]],
        ["sink-key", [sinkSample]],
      ]),
    );

    const result = await caller.getLiveRates({ environmentId: "env-1" });

    // Only SOURCE receivedEventsRate should be counted
    expect(result.rates["pipe-1"].eventsPerSec).toBe(20);
    expect(result.rates["pipe-1"].bytesPerSec).toBe(2048);
  });

  it("returns empty rates when environment has no pipelines", async () => {
    prismaMock.pipeline.findMany.mockResolvedValue([]);
    prismaMock.vectorNode.findMany.mockResolvedValue([]);

    const result = await caller.getLiveRates({ environmentId: "env-1" });

    expect(result.rates).toEqual({});
  });

  it("queries pipelines and nodes for the given environmentId", async () => {
    prismaMock.pipeline.findMany.mockResolvedValue([]);
    prismaMock.vectorNode.findMany.mockResolvedValue([]);

    await caller.getLiveRates({ environmentId: "env-42" });

    expect(prismaMock.pipeline.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { environmentId: "env-42" },
      }),
    );
    expect(prismaMock.vectorNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { environmentId: "env-42" },
      }),
    );
  });
});
