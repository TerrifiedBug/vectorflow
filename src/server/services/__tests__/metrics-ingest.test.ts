import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// Mock prisma before importing the module under test
vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import {
  ingestMetrics,
  clamp,
  computeDeltas,
  computeAggregation,
  type MetricsDataPoint,
  type PreviousSnapshot,
} from "@/server/services/metrics-ingest";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// ─── Fixture helpers ────────────────────────────────────────────────────────

const NOW = new Date("2025-06-01T12:00:00Z");
const NODE_ID = "node-abc";

function makeDataPoint(
  overrides: Partial<MetricsDataPoint> & { pipelineId: string },
): MetricsDataPoint {
  return {
    nodeId: NODE_ID,
    eventsIn: BigInt(1000),
    eventsOut: BigInt(900),
    errorsTotal: BigInt(10),
    eventsDiscarded: BigInt(5),
    bytesIn: BigInt(50000),
    bytesOut: BigInt(45000),
    utilization: 0.75,
    latencyMeanMs: 12.5,
    ...overrides,
  };
}

function makeSnapshot(overrides?: Partial<PreviousSnapshot>): PreviousSnapshot {
  return {
    eventsIn: BigInt(500),
    eventsOut: BigInt(450),
    errorsTotal: BigInt(3),
    eventsDiscarded: BigInt(2),
    bytesIn: BigInt(25000),
    bytesOut: BigInt(22000),
    ...overrides,
  };
}

// ─── Unit tests: clamp ──────────────────────────────────────────────────────

describe("clamp", () => {
  it("returns BigInt(0) when previous is null", () => {
    expect(clamp(BigInt(100), null)).toBe(BigInt(0));
  });

  it("returns BigInt(0) when previous is undefined", () => {
    expect(clamp(BigInt(100), undefined)).toBe(BigInt(0));
  });

  it("returns the positive delta when current > previous", () => {
    expect(clamp(BigInt(100), BigInt(40))).toBe(BigInt(60));
  });

  it("returns BigInt(0) on counter reset (current < previous)", () => {
    expect(clamp(BigInt(10), BigInt(100))).toBe(BigInt(0));
  });

  it("returns BigInt(0) when current equals previous", () => {
    expect(clamp(BigInt(50), BigInt(50))).toBe(BigInt(0));
  });

  it("handles large BigInt values correctly", () => {
    const large = BigInt("9007199254740992"); // 2^53
    const prev = BigInt("9007199254740000");
    expect(clamp(large, prev)).toBe(BigInt(992));
  });
});

// ─── Unit tests: computeDeltas ──────────────────────────────────────────────

describe("computeDeltas", () => {
  it("computes deltas from previous snapshots", () => {
    const dataPoints = [makeDataPoint({ pipelineId: "pipe-1" })];
    const snapshots = new Map<string, PreviousSnapshot>();
    snapshots.set(`${NODE_ID}:pipe-1`, makeSnapshot());

    const rows = computeDeltas(dataPoints, snapshots, NOW);

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.pipelineId).toBe("pipe-1");
    expect(row.nodeId).toBe(NODE_ID);
    expect(row.timestamp).toBe(NOW);
    // 1000 - 500 = 500
    expect(row.eventsIn).toBe(BigInt(500));
    // 900 - 450 = 450
    expect(row.eventsOut).toBe(BigInt(450));
    // 10 - 3 = 7
    expect(row.errorsTotal).toBe(BigInt(7));
    // 5 - 2 = 3
    expect(row.eventsDiscarded).toBe(BigInt(3));
    // 50000 - 25000 = 25000
    expect(row.bytesIn).toBe(BigInt(25000));
    // 45000 - 22000 = 23000
    expect(row.bytesOut).toBe(BigInt(23000));
    expect(row.utilization).toBe(0.75);
    expect(row.latencyMeanMs).toBe(12.5);
  });

  it("clamps all deltas to 0 when counters have reset", () => {
    const dataPoints = [
      makeDataPoint({
        pipelineId: "pipe-1",
        eventsIn: BigInt(10),
        eventsOut: BigInt(5),
        errorsTotal: BigInt(0),
        eventsDiscarded: BigInt(0),
        bytesIn: BigInt(100),
        bytesOut: BigInt(50),
      }),
    ];
    const snapshots = new Map<string, PreviousSnapshot>();
    snapshots.set(
      `${NODE_ID}:pipe-1`,
      makeSnapshot({
        eventsIn: BigInt(1000),
        eventsOut: BigInt(900),
        errorsTotal: BigInt(50),
        eventsDiscarded: BigInt(20),
        bytesIn: BigInt(50000),
        bytesOut: BigInt(40000),
      }),
    );

    const rows = computeDeltas(dataPoints, snapshots, NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0].eventsIn).toBe(BigInt(0));
    expect(rows[0].eventsOut).toBe(BigInt(0));
    expect(rows[0].errorsTotal).toBe(BigInt(0));
    expect(rows[0].eventsDiscarded).toBe(BigInt(0));
    expect(rows[0].bytesIn).toBe(BigInt(0));
    expect(rows[0].bytesOut).toBe(BigInt(0));
  });

  it("returns zero deltas when no previous snapshot exists", () => {
    const dataPoints = [makeDataPoint({ pipelineId: "pipe-new" })];
    const snapshots = new Map<string, PreviousSnapshot>();

    const rows = computeDeltas(dataPoints, snapshots, NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0].eventsIn).toBe(BigInt(0));
    expect(rows[0].eventsOut).toBe(BigInt(0));
    expect(rows[0].errorsTotal).toBe(BigInt(0));
  });

  it("returns zero deltas when previousSnapshots is undefined", () => {
    const dataPoints = [makeDataPoint({ pipelineId: "pipe-1" })];

    const rows = computeDeltas(dataPoints, undefined, NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0].eventsIn).toBe(BigInt(0));
  });

  it("computes deltas for multiple pipelines independently", () => {
    const dataPoints = [
      makeDataPoint({ pipelineId: "pipe-1", eventsIn: BigInt(200) }),
      makeDataPoint({ pipelineId: "pipe-2", eventsIn: BigInt(300) }),
    ];
    const snapshots = new Map<string, PreviousSnapshot>();
    snapshots.set(`${NODE_ID}:pipe-1`, makeSnapshot({ eventsIn: BigInt(100) }));
    snapshots.set(`${NODE_ID}:pipe-2`, makeSnapshot({ eventsIn: BigInt(50) }));

    const rows = computeDeltas(dataPoints, snapshots, NOW);

    expect(rows).toHaveLength(2);
    expect(rows[0].eventsIn).toBe(BigInt(100)); // 200 - 100
    expect(rows[1].eventsIn).toBe(BigInt(250)); // 300 - 50
  });

  it("omits latencyMeanMs when null", () => {
    const dataPoints = [
      makeDataPoint({ pipelineId: "pipe-1", latencyMeanMs: null }),
    ];

    const rows = computeDeltas(dataPoints, undefined, NOW);

    expect(rows[0]).not.toHaveProperty("latencyMeanMs");
  });
});

// ─── Unit tests: computeAggregation ─────────────────────────────────────────

describe("computeAggregation", () => {
  it("sums counter fields across multiple nodes", () => {
    const nodeRows = [
      {
        eventsIn: BigInt(100),
        eventsOut: BigInt(90),
        errorsTotal: BigInt(5),
        eventsDiscarded: BigInt(2),
        bytesIn: BigInt(5000),
        bytesOut: BigInt(4500),
        utilization: 0.6,
        latencyMeanMs: 10 as number | null,
      },
      {
        eventsIn: BigInt(200),
        eventsOut: BigInt(180),
        errorsTotal: BigInt(3),
        eventsDiscarded: BigInt(1),
        bytesIn: BigInt(10000),
        bytesOut: BigInt(9000),
        utilization: 0.8,
        latencyMeanMs: 20 as number | null,
      },
      {
        eventsIn: BigInt(150),
        eventsOut: BigInt(140),
        errorsTotal: BigInt(7),
        eventsDiscarded: BigInt(4),
        bytesIn: BigInt(7500),
        bytesOut: BigInt(7000),
        utilization: 0.7,
        latencyMeanMs: 15 as number | null,
      },
    ];

    const agg = computeAggregation("pipe-1", nodeRows, NOW);

    expect(agg.pipelineId).toBe("pipe-1");
    expect(agg.timestamp).toBe(NOW);
    expect(agg.eventsIn).toBe(BigInt(450)); // 100 + 200 + 150
    expect(agg.eventsOut).toBe(BigInt(410)); // 90 + 180 + 140
    expect(agg.errorsTotal).toBe(BigInt(15)); // 5 + 3 + 7
    expect(agg.eventsDiscarded).toBe(BigInt(7)); // 2 + 1 + 4
    expect(agg.bytesIn).toBe(BigInt(22500)); // 5000 + 10000 + 7500
    expect(agg.bytesOut).toBe(BigInt(20500)); // 4500 + 9000 + 7000
  });

  it("averages utilization across nodes", () => {
    const nodeRows = [
      {
        eventsIn: BigInt(0),
        eventsOut: BigInt(0),
        errorsTotal: BigInt(0),
        eventsDiscarded: BigInt(0),
        bytesIn: BigInt(0),
        bytesOut: BigInt(0),
        utilization: 0.4,
        latencyMeanMs: null,
      },
      {
        eventsIn: BigInt(0),
        eventsOut: BigInt(0),
        errorsTotal: BigInt(0),
        eventsDiscarded: BigInt(0),
        bytesIn: BigInt(0),
        bytesOut: BigInt(0),
        utilization: 0.8,
        latencyMeanMs: null,
      },
    ];

    const agg = computeAggregation("pipe-1", nodeRows, NOW);

    expect(agg.utilization).toBeCloseTo(0.6);
  });

  it("computes weighted-average latency across nodes", () => {
    // Node 1: 10ms latency, 190 events (100 in + 90 out) → weight = 1900
    // Node 2: 20ms latency, 380 events (200 in + 180 out) → weight = 7600
    // Weighted average = (1900 + 7600) / (190 + 380) = 9500 / 570 ≈ 16.667
    const nodeRows = [
      {
        eventsIn: BigInt(100),
        eventsOut: BigInt(90),
        errorsTotal: BigInt(0),
        eventsDiscarded: BigInt(0),
        bytesIn: BigInt(0),
        bytesOut: BigInt(0),
        utilization: 0.5,
        latencyMeanMs: 10 as number | null,
      },
      {
        eventsIn: BigInt(200),
        eventsOut: BigInt(180),
        errorsTotal: BigInt(0),
        eventsDiscarded: BigInt(0),
        bytesIn: BigInt(0),
        bytesOut: BigInt(0),
        utilization: 0.5,
        latencyMeanMs: 20 as number | null,
      },
    ];

    const agg = computeAggregation("pipe-1", nodeRows, NOW);

    // (10*190 + 20*380) / (190+380) = (1900 + 7600) / 570 ≈ 16.667
    expect(agg.latencyMeanMs).toBeCloseTo(16.667, 2);
  });

  it("omits latencyMeanMs when no node has latency", () => {
    const nodeRows = [
      {
        eventsIn: BigInt(100),
        eventsOut: BigInt(90),
        errorsTotal: BigInt(0),
        eventsDiscarded: BigInt(0),
        bytesIn: BigInt(0),
        bytesOut: BigInt(0),
        utilization: 0.5,
        latencyMeanMs: null,
      },
    ];

    const agg = computeAggregation("pipe-1", nodeRows, NOW);

    expect(agg).not.toHaveProperty("latencyMeanMs");
  });

  it("returns zero aggregation for empty node rows", () => {
    const agg = computeAggregation("pipe-1", [], NOW);

    expect(agg.eventsIn).toBe(BigInt(0));
    expect(agg.eventsOut).toBe(BigInt(0));
    expect(agg.utilization).toBe(0);
    expect(agg).not.toHaveProperty("latencyMeanMs");
  });
});

// ─── Integration tests: ingestMetrics (with mocked Prisma) ──────────────────

describe("ingestMetrics", () => {
  let mockTx: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    mockReset(prismaMock);

    // Create a mock transaction client that behaves like PrismaClient
    mockTx = mockDeep<PrismaClient>();
    mockTx.pipelineMetric.deleteMany.mockResolvedValue({ count: 0 } as never);
    mockTx.pipelineMetric.createMany.mockResolvedValue({ count: 0 } as never);
    mockTx.pipelineMetric.findMany.mockResolvedValue([] as never);

    // Wire up $transaction to call the callback with the mock tx
    prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
      if (typeof fn === "function") {
        return fn(mockTx);
      }
      return undefined;
    });
  });

  it("makes no DB calls for empty dataPoints array", async () => {
    await ingestMetrics([], undefined);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("calls $transaction exactly once for a batch", async () => {
    const dataPoints = [
      makeDataPoint({ pipelineId: "pipe-1" }),
      makeDataPoint({ pipelineId: "pipe-2" }),
    ];

    await ingestMetrics(dataPoints, new Map());

    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
  });

  it("deletes existing per-node rows before inserting new ones", async () => {
    const dataPoints = [makeDataPoint({ pipelineId: "pipe-1" })];

    await ingestMetrics(dataPoints, new Map());

    // First call to deleteMany: per-node rows
    expect(mockTx.pipelineMetric.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          nodeId: NODE_ID,
          componentId: null,
        }),
      }),
    );
  });

  it("inserts per-node rows with createMany", async () => {
    const dataPoints = [
      makeDataPoint({ pipelineId: "pipe-1" }),
      makeDataPoint({ pipelineId: "pipe-2" }),
    ];

    await ingestMetrics(dataPoints, new Map());

    // createMany should be called at least once for per-node rows
    const createManyCalls = mockTx.pipelineMetric.createMany.mock.calls;
    expect(createManyCalls.length).toBeGreaterThanOrEqual(1);

    // The first createMany call should have 2 rows (one per pipeline)
    const firstCall = createManyCalls[0][0] as { data: unknown[] };
    expect(firstCall.data).toHaveLength(2);
  });

  it("deletes existing aggregation rows and inserts new ones", async () => {
    const dataPoints = [makeDataPoint({ pipelineId: "pipe-1" })];

    // Mock findMany to return per-node rows for aggregation
    mockTx.pipelineMetric.findMany.mockResolvedValue([
      {
        id: "row-1",
        pipelineId: "pipe-1",
        nodeId: NODE_ID,
        componentId: null,
        timestamp: new Date(),
        eventsIn: BigInt(100),
        eventsOut: BigInt(90),
        errorsTotal: BigInt(5),
        eventsDiscarded: BigInt(2),
        bytesIn: BigInt(5000),
        bytesOut: BigInt(4500),
        utilization: 0.7,
        latencyMeanMs: 10,
      },
    ] as never);

    await ingestMetrics(dataPoints, new Map());

    // deleteMany should be called twice: once for per-node, once for aggregation
    expect(mockTx.pipelineMetric.deleteMany).toHaveBeenCalledTimes(2);

    // Second deleteMany: aggregation rows (nodeId: null)
    const secondDeleteCall = mockTx.pipelineMetric.deleteMany.mock.calls[1][0] as {
      where: { pipelineId: { in: string[] }; nodeId: null };
    };
    expect(secondDeleteCall.where.nodeId).toBeNull();
    expect(secondDeleteCall.where.pipelineId).toEqual({ in: ["pipe-1"] });

    // createMany called twice: once for per-node rows, once for aggregation rows
    expect(mockTx.pipelineMetric.createMany).toHaveBeenCalledTimes(2);
  });

  it("queries per-node rows for each touched pipeline during aggregation", async () => {
    const dataPoints = [
      makeDataPoint({ pipelineId: "pipe-1" }),
      makeDataPoint({ pipelineId: "pipe-2" }),
    ];
    mockTx.pipelineMetric.findMany.mockResolvedValue([] as never);

    await ingestMetrics(dataPoints, new Map());

    // findMany called once per pipeline for aggregation
    expect(mockTx.pipelineMetric.findMany).toHaveBeenCalledTimes(2);
  });

  it("preserves fire-and-forget call pattern in heartbeat handler", async () => {
    // This test verifies the function returns a Promise (enabling .catch())
    const dataPoints = [makeDataPoint({ pipelineId: "pipe-1" })];
    const result = ingestMetrics(dataPoints, new Map());

    expect(result).toBeInstanceOf(Promise);
    expect(typeof result.catch).toBe("function");

    await result; // Clean up
  });

  it("propagates transaction errors to the caller", async () => {
    prismaMock.$transaction.mockRejectedValue(
      new Error("connection timeout") as never,
    );

    const dataPoints = [makeDataPoint({ pipelineId: "pipe-1" })];

    await expect(ingestMetrics(dataPoints, new Map())).rejects.toThrow(
      "connection timeout",
    );
  });
});
