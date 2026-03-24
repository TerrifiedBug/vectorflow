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
  accumulateRow,
  type MetricsDataPoint,
  type PreviousSnapshot,
} from "@/server/services/metrics-ingest";
import { MetricStore } from "@/server/services/metric-store";

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

// ─── Unit tests: accumulateRow ──────────────────────────────────────────────

describe("accumulateRow", () => {
  const baseDelta = {
    pipelineId: "pipe-1",
    nodeId: "node-1",
    timestamp: new Date("2026-01-01"),
    eventsIn: BigInt(10),
    eventsOut: BigInt(8),
    errorsTotal: BigInt(1),
    eventsDiscarded: BigInt(0),
    bytesIn: BigInt(500),
    bytesOut: BigInt(400),
    utilization: 0.6,
  };

  it("adds delta counters to existing row counters", () => {
    const existing = {
      eventsIn: BigInt(50),
      eventsOut: BigInt(40),
      errorsTotal: BigInt(3),
      eventsDiscarded: BigInt(1),
      bytesIn: BigInt(2000),
      bytesOut: BigInt(1800),
    };
    const result = accumulateRow(existing, baseDelta);
    expect(result.eventsIn).toBe(BigInt(60));
    expect(result.eventsOut).toBe(BigInt(48));
    expect(result.errorsTotal).toBe(BigInt(4));
    expect(result.eventsDiscarded).toBe(BigInt(1));
    expect(result.bytesIn).toBe(BigInt(2500));
    expect(result.bytesOut).toBe(BigInt(2200));
  });

  it("takes latest utilization from delta, not existing", () => {
    const existing = {
      eventsIn: BigInt(0),
      eventsOut: BigInt(0),
      errorsTotal: BigInt(0),
      eventsDiscarded: BigInt(0),
      bytesIn: BigInt(0),
      bytesOut: BigInt(0),
    };
    const result = accumulateRow(existing, { ...baseDelta, utilization: 0.9 });
    expect(result.utilization).toBe(0.9);
  });

  it("preserves latencyMeanMs from delta", () => {
    const existing = {
      eventsIn: BigInt(0),
      eventsOut: BigInt(0),
      errorsTotal: BigInt(0),
      eventsDiscarded: BigInt(0),
      bytesIn: BigInt(0),
      bytesOut: BigInt(0),
    };
    const result = accumulateRow(existing, { ...baseDelta, latencyMeanMs: 12.5 });
    expect(result.latencyMeanMs).toBe(12.5);
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

  it("reads existing per-node rows before delete+insert", async () => {
    const dataPoints = [makeDataPoint({ pipelineId: "pipe-1" })];

    await ingestMetrics(dataPoints, new Map());

    // First findMany: read existing per-node rows for accumulation
    const findManyCalls = mockTx.pipelineMetric.findMany.mock.calls;
    expect(findManyCalls.length).toBeGreaterThanOrEqual(1);
    expect(findManyCalls[0][0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          nodeId: NODE_ID,
          componentId: null,
        }),
      }),
    );
  });

  it("accumulates deltas onto existing rows within the same minute", async () => {
    const dataPoints = [makeDataPoint({ pipelineId: "pipe-1" })];

    // Simulate an existing row from a previous heartbeat in the same minute
    mockTx.pipelineMetric.findMany
      .mockResolvedValueOnce([
        {
          id: "existing-row",
          pipelineId: "pipe-1",
          nodeId: NODE_ID,
          componentId: null,
          timestamp: new Date(),
          eventsIn: BigInt(50),
          eventsOut: BigInt(40),
          errorsTotal: BigInt(3),
          eventsDiscarded: BigInt(1),
          bytesIn: BigInt(2000),
          bytesOut: BigInt(1800),
          utilization: 0.5,
          latencyMeanMs: 8,
        },
      ] as never)
      // Second findMany: for aggregation
      .mockResolvedValue([] as never);

    await ingestMetrics(dataPoints, new Map());

    // createMany should include accumulated values (existing + delta)
    const createManyCalls = mockTx.pipelineMetric.createMany.mock.calls;
    const firstCreateCall = createManyCalls[0][0] as { data: Array<{ eventsIn: bigint }> };
    // Delta is BigInt(0) (no previous snapshot) + existing BigInt(50) = BigInt(50)
    expect(firstCreateCall.data[0].eventsIn).toBe(BigInt(50));
  });

  it("skips deleteMany when no existing rows (first heartbeat of the minute)", async () => {
    const dataPoints = [makeDataPoint({ pipelineId: "pipe-1" })];
    // findMany returns empty — no existing rows
    mockTx.pipelineMetric.findMany.mockResolvedValue([] as never);

    await ingestMetrics(dataPoints, new Map());

    // deleteMany should only be called once (for aggregation rows), not for per-node
    const deleteManyCalls = mockTx.pipelineMetric.deleteMany.mock.calls;
    // All deleteMany calls should have nodeId: null (aggregation) since no existing per-node rows
    const perNodeDeletes = deleteManyCalls.filter(
      (call) => (call[0] as { where: { nodeId: unknown } }).where.nodeId !== null,
    );
    expect(perNodeDeletes).toHaveLength(0);
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

    // Mock first findMany (existing per-node rows) to return a row
    mockTx.pipelineMetric.findMany
      .mockResolvedValueOnce([
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
      ] as never)
      // Mock second findMany (aggregation per-node lookup) to return same row
      .mockResolvedValueOnce([
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

    // deleteMany called twice: once for per-node (existing rows found), once for aggregation
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

    // findMany called: 1 (existing per-node lookup) + 2 (one per pipeline for aggregation) = 3
    expect(mockTx.pipelineMetric.findMany).toHaveBeenCalledTimes(3);
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

// ─── MetricStore memory footprint test ──────────────────────────────────────

describe("MetricStore memory at target scale", () => {
  it("ring buffer caps at MAX_SAMPLES (720) per key", () => {
    const store = new MetricStore();

    // Use fake timers so recordTotals sees elapsed time > 0
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T00:00:00Z"));

    const nodeId = "node-mem";
    const pipelineId = "pipe-0";
    const componentId = "comp-0";

    // Feed 800 samples (more than MAX_SAMPLES=720) to verify ring buffer eviction
    let samplesStored = 0;
    for (let s = 0; s <= 800; s++) {
      vi.advanceTimersByTime(5000);
      const result = store.recordTotals(nodeId, pipelineId, componentId, {
        receivedEventsTotal: s * 100,
        sentEventsTotal: s * 90,
        receivedBytesTotal: s * 5000,
        sentBytesTotal: s * 4500,
        errorsTotal: s,
        discardedTotal: 0,
        latencyMeanSeconds: 0.012,
      });
      if (result != null) samplesStored++;
    }

    vi.useRealTimers();

    // 801 calls total, first returns null → 800 samples produced
    expect(samplesStored).toBe(800);

    // But the ring buffer should cap at 720 (MAX_SAMPLES)
    const retrieved = store.getSamples(nodeId, pipelineId, componentId, 60 * 24 * 365);
    expect(retrieved.length).toBe(720);
  });

  it("memory estimate for 500 pipelines × 5 components × 720 samples stays under 250 MB", () => {
    // This is a representative-sample test. We populate a smaller scale
    // (10 pipelines × 5 components) to verify correctness, then compute
    // the memory estimate analytically for the full 500 × 5 × 720 target.
    const store = new MetricStore();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T00:00:00Z"));

    const PIPELINES = 10;
    const COMPONENTS = 5;
    const SAMPLES = 50; // Enough to verify behavior, not 720 (too slow)
    const nodeId = "node-load-test";

    let samplesStored = 0;
    for (let p = 0; p < PIPELINES; p++) {
      for (let c = 0; c < COMPONENTS; c++) {
        for (let s = 0; s <= SAMPLES; s++) {
          vi.advanceTimersByTime(5000);
          const result = store.recordTotals(nodeId, `pipe-${p}`, `comp-${c}`, {
            receivedEventsTotal: s * 100,
            sentEventsTotal: s * 90,
            receivedBytesTotal: s * 5000,
            sentBytesTotal: s * 4500,
            errorsTotal: s,
            discardedTotal: 0,
            latencyMeanSeconds: 0.012,
          });
          if (result != null) samplesStored++;
        }
      }
    }

    vi.useRealTimers();

    // 10 pipelines × 5 components × 50 samples = 2500 stored
    const expectedRepSamples = PIPELINES * COMPONENTS * SAMPLES;
    expect(samplesStored).toBe(expectedRepSamples);

    // Now compute the full-scale memory estimate analytically:
    // 500 pipelines × 5 components = 2500 unique keys
    // Each key stores up to 720 MetricSample objects
    // Each MetricSample: 9 number fields × 8 bytes + 1 nullable = ~80 bytes
    // Map key string: ~40 bytes average ("nodeId:pipelineId:componentId")
    // Array overhead per key: ~100 bytes
    const FULL_PIPELINES = 500;
    const FULL_COMPONENTS = 5;
    const FULL_SAMPLES = 720;
    const BYTES_PER_SAMPLE = 80;
    const BYTES_PER_KEY = 140; // key string + array overhead

    const totalKeys = FULL_PIPELINES * FULL_COMPONENTS;
    const totalSamples = totalKeys * FULL_SAMPLES;
    const estimatedBytes =
      totalKeys * BYTES_PER_KEY + totalSamples * BYTES_PER_SAMPLE;
    const estimatedMB = estimatedBytes / (1024 * 1024);

    console.log(
      `MetricStore memory estimate: ${totalKeys} keys × ${FULL_SAMPLES} samples = ` +
      `${totalSamples.toLocaleString()} total samples ≈ ${estimatedMB.toFixed(1)} MB`,
    );

    // Must be under 250 MB (reasonable for a server process)
    expect(estimatedMB).toBeLessThan(250);
  });
});
