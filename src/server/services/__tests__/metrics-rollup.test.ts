import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared mock objects, hoisted so the vi.mock factories below can reference them
// without a dynamic import.
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    organization: { findMany: vi.fn() },
    nodeMetric: { findMany: vi.fn() },
    pipelineMetric: { findMany: vi.fn() },
    nodeMetricRollup: { deleteMany: vi.fn(), createMany: vi.fn() },
    pipelineMetricRollup: { deleteMany: vi.fn(), createMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
  basePrisma: prismaMock,
  adminPrisma: prismaMock,
}));

// withOrgTx runs its callback with a tenant-scoped tx; in the unit test the tx
// IS the prisma mock so assertions can inspect the rollup writes.
vi.mock("@/lib/with-org-tx", () => ({
  withOrgTx: vi.fn(
    async (_orgId: string, fn: (tx: typeof prismaMock) => Promise<unknown>) =>
      fn(prismaMock),
  ),
}));

vi.mock("@/lib/logger", () => ({
  infoLog: vi.fn(),
  errorLog: vi.fn(),
}));

import {
  bucketNodeMetrics,
  bucketPipelineMetrics,
  truncateToBucketStart,
  resolveRollupWindow,
  rollupMetrics,
  type RawNodeMetric,
  type RawPipelineMetric,
} from "../metrics-rollup";

function rawNode(
  nodeId: string,
  ts: string,
  o: Partial<RawNodeMetric> = {},
): RawNodeMetric {
  return {
    nodeId,
    timestamp: new Date(ts),
    memoryUsedBytes: BigInt(100),
    memoryTotalBytes: BigInt(1000),
    cpuSecondsTotal: 10,
    cpuSecondsIdle: 4,
    loadAvg1: 1,
    loadAvg5: 1,
    loadAvg15: 1,
    fsUsedBytes: BigInt(10),
    fsTotalBytes: BigInt(100),
    diskReadBytes: BigInt(2),
    diskWrittenBytes: BigInt(3),
    netRxBytes: BigInt(4),
    netTxBytes: BigInt(5),
    ...o,
  };
}

function rawPipe(o: Partial<RawPipelineMetric> = {}): RawPipelineMetric {
  return {
    pipelineId: "p1",
    nodeId: null,
    componentId: null,
    timestamp: new Date("2026-03-10T08:10:00Z"),
    eventsIn: BigInt(0),
    eventsOut: BigInt(0),
    eventsDiscarded: BigInt(0),
    errorsTotal: BigInt(0),
    bytesIn: BigInt(0),
    bytesOut: BigInt(0),
    utilization: 0,
    latencyMeanMs: null,
    ...o,
  };
}

describe("metrics-rollup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Bucket boundaries ─────────────────────────────────────────────────────

  describe("truncateToBucketStart", () => {
    it("truncates to the start of the UTC hour", () => {
      expect(
        truncateToBucketStart(new Date("2026-03-10T08:37:42.123Z"), "HOUR"),
      ).toEqual(new Date("2026-03-10T08:00:00.000Z"));
    });

    it("truncates to UTC midnight for DAY", () => {
      expect(
        truncateToBucketStart(new Date("2026-03-10T08:37:42.123Z"), "DAY"),
      ).toEqual(new Date("2026-03-10T00:00:00.000Z"));
    });
  });

  describe("resolveRollupWindow", () => {
    it("excludes the in-progress hour and spans the lookback", () => {
      const w = resolveRollupWindow(new Date("2026-03-10T10:30:00Z"), "HOUR", 3);
      // windowEnd = start of the current (incomplete) bucket -> exclusive.
      expect(w.windowEnd).toEqual(new Date("2026-03-10T10:00:00Z"));
      expect(w.windowStart).toEqual(new Date("2026-03-10T07:00:00Z"));
    });

    it("excludes today for DAY granularity", () => {
      const w = resolveRollupWindow(new Date("2026-03-10T10:30:00Z"), "DAY", 2);
      expect(w.windowEnd).toEqual(new Date("2026-03-10T00:00:00Z"));
      expect(w.windowStart).toEqual(new Date("2026-03-08T00:00:00Z"));
    });
  });

  // ─── Node aggregation math ─────────────────────────────────────────────────

  describe("bucketNodeMetrics", () => {
    it("averages gauges, peaks memory/load, counts samples", () => {
      const rows: RawNodeMetric[] = [
        {
          nodeId: "n1",
          timestamp: new Date("2026-03-10T08:10:00Z"),
          memoryUsedBytes: BigInt(100),
          memoryTotalBytes: BigInt(1000),
          cpuSecondsTotal: 10,
          cpuSecondsIdle: 4,
          loadAvg1: 1,
          loadAvg5: 2,
          loadAvg15: 3,
          fsUsedBytes: BigInt(10),
          fsTotalBytes: BigInt(100),
          diskReadBytes: BigInt(2),
          diskWrittenBytes: BigInt(4),
          netRxBytes: BigInt(6),
          netTxBytes: BigInt(8),
        },
        {
          nodeId: "n1",
          timestamp: new Date("2026-03-10T08:50:00Z"),
          memoryUsedBytes: BigInt(300),
          memoryTotalBytes: BigInt(1000),
          cpuSecondsTotal: 30,
          cpuSecondsIdle: 8,
          loadAvg1: 5,
          loadAvg5: 4,
          loadAvg15: 3,
          fsUsedBytes: BigInt(30),
          fsTotalBytes: BigInt(100),
          diskReadBytes: BigInt(6),
          diskWrittenBytes: BigInt(8),
          netRxBytes: BigInt(10),
          netTxBytes: BigInt(12),
        },
      ];

      expect(bucketNodeMetrics(rows, "HOUR")).toEqual([
        {
          nodeId: "n1",
          bucketStart: new Date("2026-03-10T08:00:00Z"),
          sampleCount: 2,
          memoryUsedBytes: BigInt(200), // avg(100, 300)
          memoryTotalBytes: BigInt(1000),
          cpuSecondsTotal: 20, // avg(10, 30)
          cpuSecondsIdle: 6, // avg(4, 8)
          loadAvg1: 3, // avg(1, 5)
          loadAvg5: 3, // avg(2, 4)
          loadAvg15: 3,
          fsUsedBytes: BigInt(20), // avg(10, 30)
          fsTotalBytes: BigInt(100),
          diskReadBytes: BigInt(4), // avg(2, 6)
          diskWrittenBytes: BigInt(6), // avg(4, 8)
          netRxBytes: BigInt(8), // avg(6, 10)
          netTxBytes: BigInt(10), // avg(8, 12)
          maxMemoryUsedBytes: BigInt(300), // peak
          maxLoadAvg1: 5, // peak
        },
      ]);
    });

    it("separates buckets per node and per hour", () => {
      const rows = [
        rawNode("n1", "2026-03-10T08:10:00Z"),
        rawNode("n1", "2026-03-10T09:10:00Z"),
        rawNode("n2", "2026-03-10T08:10:00Z"),
      ];
      expect(bucketNodeMetrics(rows, "HOUR")).toHaveLength(3);
    });

    it("collapses a full day into one bucket for DAY granularity", () => {
      const rows = [
        rawNode("n1", "2026-03-10T08:00:00Z", { memoryUsedBytes: BigInt(100) }),
        rawNode("n1", "2026-03-10T20:00:00Z", { memoryUsedBytes: BigInt(500) }),
      ];
      const out = bucketNodeMetrics(rows, "DAY");
      expect(out).toHaveLength(1);
      expect(out[0].bucketStart).toEqual(new Date("2026-03-10T00:00:00Z"));
      expect(out[0].sampleCount).toBe(2);
      expect(out[0].memoryUsedBytes).toBe(BigInt(300)); // avg(100, 500)
      expect(out[0].maxMemoryUsedBytes).toBe(BigInt(500));
    });
  });

  // ─── Pipeline aggregation math ─────────────────────────────────────────────

  describe("bucketPipelineMetrics", () => {
    it("sums counters, averages utilization/latency, peaks latency, maps null componentId to ''", () => {
      const rows = [
        rawPipe({
          timestamp: new Date("2026-03-10T08:10:00Z"),
          eventsIn: BigInt(100),
          eventsOut: BigInt(90),
          eventsDiscarded: BigInt(5),
          errorsTotal: BigInt(1),
          bytesIn: BigInt(1000),
          bytesOut: BigInt(900),
          utilization: 0.4,
          latencyMeanMs: 10,
        }),
        rawPipe({
          timestamp: new Date("2026-03-10T08:50:00Z"),
          eventsIn: BigInt(200),
          eventsOut: BigInt(180),
          eventsDiscarded: BigInt(5),
          errorsTotal: BigInt(3),
          bytesIn: BigInt(2000),
          bytesOut: BigInt(1800),
          utilization: 0.6,
          latencyMeanMs: 30,
        }),
      ];

      expect(bucketPipelineMetrics(rows, "HOUR")).toEqual([
        {
          pipelineId: "p1",
          componentId: "",
          bucketStart: new Date("2026-03-10T08:00:00Z"),
          sampleCount: 2,
          eventsIn: BigInt(300),
          eventsOut: BigInt(270),
          eventsDiscarded: BigInt(10),
          errorsTotal: BigInt(4),
          bytesIn: BigInt(3000),
          bytesOut: BigInt(2700),
          utilization: 0.5, // avg(0.4, 0.6)
          latencyMeanMs: 20, // avg(10, 30)
          maxLatencyMs: 30, // peak
        },
      ]);
    });

    it("excludes per-node rows so the '' aggregate is not double-counted", () => {
      const ts = new Date("2026-03-10T08:10:00Z");
      const rows = [
        // True pipeline aggregate (nodeId null, componentId null).
        rawPipe({ nodeId: null, componentId: null, timestamp: ts, eventsIn: BigInt(300) }),
        // Per-node addends of that aggregate — must be dropped.
        rawPipe({ nodeId: "n1", componentId: null, timestamp: ts, eventsIn: BigInt(100) }),
        rawPipe({ nodeId: "n2", componentId: null, timestamp: ts, eventsIn: BigInt(200) }),
      ];

      const out = bucketPipelineMetrics(rows, "HOUR");
      const agg = out.find((r) => r.componentId === "");
      expect(agg?.eventsIn).toBe(BigInt(300)); // not 600
      expect(agg?.sampleCount).toBe(1); // only the aggregate row counted
    });

    it("rolls per-component rows up under their componentId", () => {
      const rows = [
        rawPipe({
          nodeId: "n1",
          componentId: "transform-1",
          timestamp: new Date("2026-03-10T08:10:00Z"),
          latencyMeanMs: 12,
        }),
        rawPipe({
          nodeId: "n2",
          componentId: "transform-1",
          timestamp: new Date("2026-03-10T08:40:00Z"),
          latencyMeanMs: 8,
        }),
      ];

      const out = bucketPipelineMetrics(rows, "HOUR");
      const comp = out.find((r) => r.componentId === "transform-1");
      expect(comp?.sampleCount).toBe(2);
      expect(comp?.latencyMeanMs).toBe(10); // avg(12, 8)
      expect(comp?.maxLatencyMs).toBe(12);
    });

    it("averages latency over non-null samples only, null when none present", () => {
      const withLatency = bucketPipelineMetrics(
        [
          rawPipe({ timestamp: new Date("2026-03-10T08:10:00Z"), latencyMeanMs: null }),
          rawPipe({ timestamp: new Date("2026-03-10T08:40:00Z"), latencyMeanMs: 40 }),
        ],
        "HOUR",
      );
      expect(withLatency[0].latencyMeanMs).toBe(40); // avg over the single non-null
      expect(withLatency[0].maxLatencyMs).toBe(40);
      expect(withLatency[0].sampleCount).toBe(2); // count includes the null row

      const noLatency = bucketPipelineMetrics(
        [rawPipe({ latencyMeanMs: null })],
        "HOUR",
      );
      expect(noLatency[0].latencyMeanMs).toBeNull();
      expect(noLatency[0].maxLatencyMs).toBeNull();
    });
  });

  // ─── Orchestration + idempotency ───────────────────────────────────────────

  describe("rollupMetrics", () => {
    it("rolls up each active org and writes correct aggregates", async () => {
      prismaMock.organization.findMany.mockResolvedValue([{ id: "org-1" }]);
      prismaMock.nodeMetric.findMany.mockResolvedValue([
        rawNode("n1", "2026-03-10T08:10:00Z", { memoryUsedBytes: BigInt(100), loadAvg1: 1 }),
        rawNode("n1", "2026-03-10T08:40:00Z", { memoryUsedBytes: BigInt(300), loadAvg1: 5 }),
      ]);
      prismaMock.pipelineMetric.findMany.mockResolvedValue([]);

      const result = await rollupMetrics({
        granularity: "HOUR",
        now: new Date("2026-03-10T10:30:00Z"),
      });

      expect(result.organizations).toBe(1);
      expect(result.nodeRollups).toBe(1);
      expect(prismaMock.nodeMetricRollup.deleteMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.nodeMetricRollup.createMany).toHaveBeenCalledTimes(1);

      const created = prismaMock.nodeMetricRollup.createMany.mock.calls[0][0].data;
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        organizationId: "org-1",
        nodeId: "n1",
        granularity: "HOUR",
        bucketStart: new Date("2026-03-10T08:00:00Z"),
        sampleCount: 2,
        memoryUsedBytes: BigInt(200),
        maxMemoryUsedBytes: BigInt(300),
        maxLoadAvg1: 5,
      });

      // The recomputed window is deleted before insert (delete-then-insert).
      const deleteWhere = prismaMock.nodeMetricRollup.deleteMany.mock.calls[0][0]
        .where;
      expect(deleteWhere).toMatchObject({
        organizationId: "org-1",
        granularity: "HOUR",
        bucketStart: {
          gte: new Date("2026-03-10T07:00:00Z"),
          lt: new Date("2026-03-10T10:00:00Z"),
        },
      });
    });

    it("is idempotent: a re-run replaces the window with an identical payload", async () => {
      prismaMock.organization.findMany.mockResolvedValue([{ id: "org-1" }]);
      prismaMock.nodeMetric.findMany.mockResolvedValue([
        rawNode("n1", "2026-03-10T08:10:00Z", { memoryUsedBytes: BigInt(100) }),
        rawNode("n1", "2026-03-10T08:40:00Z", { memoryUsedBytes: BigInt(300) }),
      ]);
      prismaMock.pipelineMetric.findMany.mockResolvedValue([]);

      const now = new Date("2026-03-10T10:30:00Z");
      await rollupMetrics({ granularity: "HOUR", now });
      await rollupMetrics({ granularity: "HOUR", now });

      const first = prismaMock.nodeMetricRollup.createMany.mock.calls[0][0].data;
      const second = prismaMock.nodeMetricRollup.createMany.mock.calls[1][0].data;
      expect(second).toEqual(first);

      // Each run clears the window before inserting — no double-count on re-run.
      expect(prismaMock.nodeMetricRollup.deleteMany).toHaveBeenCalledTimes(2);
      expect(
        prismaMock.nodeMetricRollup.deleteMany.mock.invocationCallOrder[0],
      ).toBeLessThan(
        prismaMock.nodeMetricRollup.createMany.mock.invocationCallOrder[0],
      );
    });

    it("does not write empty rollup batches", async () => {
      prismaMock.organization.findMany.mockResolvedValue([{ id: "org-1" }]);
      prismaMock.nodeMetric.findMany.mockResolvedValue([]);
      prismaMock.pipelineMetric.findMany.mockResolvedValue([]);

      const result = await rollupMetrics({ granularity: "DAY" });

      // deleteMany still runs (clears stale window) but createMany is skipped.
      expect(prismaMock.nodeMetricRollup.deleteMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.nodeMetricRollup.createMany).not.toHaveBeenCalled();
      expect(prismaMock.pipelineMetricRollup.createMany).not.toHaveBeenCalled();
      expect(result.nodeRollups).toBe(0);
      expect(result.pipelineRollups).toBe(0);
    });

    it("continues the sweep when one org's rollup throws", async () => {
      prismaMock.organization.findMany.mockResolvedValue([
        { id: "org-1" },
        { id: "org-2" },
      ]);
      prismaMock.nodeMetric.findMany
        .mockRejectedValueOnce(new Error("db down")) // org-1
        .mockResolvedValueOnce([]); // org-2
      prismaMock.pipelineMetric.findMany.mockResolvedValue([]);

      const result = await rollupMetrics({
        granularity: "HOUR",
        now: new Date("2026-03-10T10:30:00Z"),
      });

      expect(result.organizations).toBe(2);
      // org-2 still processed despite org-1's failure.
      expect(prismaMock.pipelineMetric.findMany).toHaveBeenCalledTimes(1);
    });

    it("writes pipeline rollups including the '' aggregate bucket", async () => {
      prismaMock.organization.findMany.mockResolvedValue([{ id: "org-1" }]);
      prismaMock.nodeMetric.findMany.mockResolvedValue([]);
      prismaMock.pipelineMetric.findMany.mockResolvedValue([
        rawPipe({
          nodeId: null,
          componentId: null,
          timestamp: new Date("2026-03-10T08:10:00Z"),
          eventsIn: BigInt(500),
          bytesIn: BigInt(5000),
        }),
      ]);

      const result = await rollupMetrics({
        granularity: "HOUR",
        now: new Date("2026-03-10T10:30:00Z"),
      });

      expect(result.pipelineRollups).toBe(1);
      const created =
        prismaMock.pipelineMetricRollup.createMany.mock.calls[0][0].data;
      expect(created[0]).toMatchObject({
        organizationId: "org-1",
        pipelineId: "p1",
        componentId: "",
        granularity: "HOUR",
        eventsIn: BigInt(500),
        bytesIn: BigInt(5000),
      });
    });
  });
});
