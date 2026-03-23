import { describe, it, expect } from "vitest";
import { computeChartMetrics } from "@/server/services/dashboard-data";

// ─── Fixture helpers ────────────────────────────────────────────────────────

function makePipelineRow(overrides: {
  pipelineId: string;
  nodeId?: string | null;
  timestamp: Date;
  eventsIn?: bigint;
  eventsOut?: bigint;
  bytesIn?: bigint;
  bytesOut?: bigint;
  errorsTotal?: bigint;
  eventsDiscarded?: bigint;
  latencyMeanMs?: number | null;
}) {
  return {
    pipelineId: overrides.pipelineId,
    nodeId: overrides.nodeId ?? null,
    timestamp: overrides.timestamp,
    eventsIn: overrides.eventsIn ?? BigInt(0),
    eventsOut: overrides.eventsOut ?? BigInt(0),
    bytesIn: overrides.bytesIn ?? BigInt(0),
    bytesOut: overrides.bytesOut ?? BigInt(0),
    errorsTotal: overrides.errorsTotal ?? BigInt(0),
    eventsDiscarded: overrides.eventsDiscarded ?? BigInt(0),
    latencyMeanMs: overrides.latencyMeanMs ?? null,
  };
}

function makeNodeRow(overrides: {
  nodeId: string;
  timestamp: Date;
  cpuSecondsTotal?: number;
  cpuSecondsIdle?: number;
  memoryUsedBytes?: bigint;
  memoryTotalBytes?: bigint;
  diskReadBytes?: bigint;
  diskWrittenBytes?: bigint;
  netRxBytes?: bigint;
  netTxBytes?: bigint;
}) {
  return {
    nodeId: overrides.nodeId,
    timestamp: overrides.timestamp,
    cpuSecondsTotal: overrides.cpuSecondsTotal ?? 0,
    cpuSecondsIdle: overrides.cpuSecondsIdle ?? 0,
    memoryUsedBytes: overrides.memoryUsedBytes ?? BigInt(0),
    memoryTotalBytes: overrides.memoryTotalBytes ?? BigInt(0),
    diskReadBytes: overrides.diskReadBytes ?? BigInt(0),
    diskWrittenBytes: overrides.diskWrittenBytes ?? BigInt(0),
    netRxBytes: overrides.netRxBytes ?? BigInt(0),
    netTxBytes: overrides.netTxBytes ?? BigInt(0),
  };
}

const emptyFilterOptions = { nodes: [], pipelines: [] };

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("computeChartMetrics", () => {
  describe("groupBy: pipeline", () => {
    it("buckets eventsIn/eventsOut by pipeline name", () => {
      const t1 = new Date("2025-01-01T00:00:00Z");
      const t2 = new Date("2025-01-01T00:01:00Z");
      const pipelineNameMap = new Map([
        ["p1", "Pipeline Alpha"],
        ["p2", "Pipeline Beta"],
      ]);

      const result = computeChartMetrics({
        range: "1h",
        groupBy: "pipeline",
        nodeNameMap: new Map(),
        pipelineNameMap,
        pipelineRows: [
          makePipelineRow({ pipelineId: "p1", timestamp: t1, eventsIn: BigInt(600), eventsOut: BigInt(300) }),
          makePipelineRow({ pipelineId: "p2", timestamp: t1, eventsIn: BigInt(1200), eventsOut: BigInt(600) }),
          makePipelineRow({ pipelineId: "p1", timestamp: t2, eventsIn: BigInt(1800), eventsOut: BigInt(900) }),
        ],
        nodeRows: [],
        filterOptions: emptyFilterOptions,
      });

      // Values are divided by 60 (per-second rate from per-minute counters)
      expect(result.pipeline.eventsIn["Pipeline Alpha"]).toHaveLength(2);
      expect(result.pipeline.eventsIn["Pipeline Alpha"]![0]!.v).toBe(600 / 60); // 10
      expect(result.pipeline.eventsIn["Pipeline Alpha"]![1]!.v).toBe(1800 / 60); // 30
      expect(result.pipeline.eventsIn["Pipeline Beta"]).toHaveLength(1);
      expect(result.pipeline.eventsIn["Pipeline Beta"]![0]!.v).toBe(1200 / 60); // 20

      expect(result.pipeline.eventsOut["Pipeline Alpha"]).toHaveLength(2);
      expect(result.pipeline.eventsOut["Pipeline Alpha"]![0]!.v).toBe(300 / 60); // 5
    });

    it("falls back to pipelineId when name is not in map", () => {
      const t1 = new Date("2025-01-01T00:00:00Z");

      const result = computeChartMetrics({
        range: "1h",
        groupBy: "pipeline",
        nodeNameMap: new Map(),
        pipelineNameMap: new Map(), // empty map — no name mappings
        pipelineRows: [
          makePipelineRow({ pipelineId: "unmapped-id", timestamp: t1, eventsIn: BigInt(60) }),
        ],
        nodeRows: [],
        filterOptions: emptyFilterOptions,
      });

      expect(result.pipeline.eventsIn["unmapped-id"]).toBeDefined();
      expect(result.pipeline.eventsIn["unmapped-id"]![0]!.v).toBe(1);
    });
  });

  describe("groupBy: node", () => {
    it("sums pipeline metrics per node name", () => {
      const t1 = new Date("2025-01-01T00:00:00Z");
      const nodeNameMap = new Map([
        ["n1", "Node One"],
        ["n2", "Node Two"],
      ]);

      const result = computeChartMetrics({
        range: "1h",
        groupBy: "node",
        nodeNameMap,
        pipelineNameMap: new Map(),
        pipelineRows: [
          // Two pipelines on node n1 at same timestamp → should be summed
          makePipelineRow({ pipelineId: "p1", nodeId: "n1", timestamp: t1, eventsIn: BigInt(600), eventsOut: BigInt(300) }),
          makePipelineRow({ pipelineId: "p2", nodeId: "n1", timestamp: t1, eventsIn: BigInt(1200), eventsOut: BigInt(600) }),
          // One pipeline on node n2
          makePipelineRow({ pipelineId: "p3", nodeId: "n2", timestamp: t1, eventsIn: BigInt(180), eventsOut: BigInt(60) }),
        ],
        nodeRows: [],
        filterOptions: emptyFilterOptions,
      });

      // Node One: (600 + 1200) / 60 = 30 eventsIn/s
      expect(result.pipeline.eventsIn["Node One"]).toHaveLength(1);
      expect(result.pipeline.eventsIn["Node One"]![0]!.v).toBe((600 + 1200) / 60);

      // Node Two: 180 / 60 = 3 eventsIn/s
      expect(result.pipeline.eventsIn["Node Two"]).toHaveLength(1);
      expect(result.pipeline.eventsIn["Node Two"]![0]!.v).toBe(180 / 60);
    });

    it("derives CPU and memory series from node rows", () => {
      const t1 = new Date("2025-01-01T00:00:00Z");
      const t2 = new Date("2025-01-01T00:01:00Z");
      const nodeNameMap = new Map([["n1", "Node One"]]);

      const result = computeChartMetrics({
        range: "1h",
        groupBy: "node",
        nodeNameMap,
        pipelineNameMap: new Map(),
        pipelineRows: [],
        nodeRows: [
          makeNodeRow({
            nodeId: "n1",
            timestamp: t1,
            cpuSecondsTotal: 100,
            cpuSecondsIdle: 80,
            memoryUsedBytes: BigInt(500),
            memoryTotalBytes: BigInt(1000),
          }),
          makeNodeRow({
            nodeId: "n1",
            timestamp: t2,
            cpuSecondsTotal: 200,
            cpuSecondsIdle: 160,
            memoryUsedBytes: BigInt(700),
            memoryTotalBytes: BigInt(1000),
          }),
        ],
        filterOptions: emptyFilterOptions,
      });

      // CPU: (delta_total - delta_idle) / delta_total * 100 = (100 - 80) / 100 * 100 = 20%
      expect(result.system.cpu["Node One"]).toHaveLength(1);
      expect(result.system.cpu["Node One"]![0]!.v).toBe(20);

      // Memory: 700/1000 * 100 = 70%
      expect(result.system.memory["Node One"]).toHaveLength(1);
      expect(result.system.memory["Node One"]![0]!.v).toBe(70);
    });
  });

  describe("groupBy: aggregate", () => {
    it("sums all pipeline metrics into a single 'Total' series", () => {
      const t1 = new Date("2025-01-01T00:00:00Z");

      const result = computeChartMetrics({
        range: "1h",
        groupBy: "aggregate",
        nodeNameMap: new Map(),
        pipelineNameMap: new Map([
          ["p1", "Pipeline Alpha"],
          ["p2", "Pipeline Beta"],
        ]),
        pipelineRows: [
          makePipelineRow({ pipelineId: "p1", timestamp: t1, eventsIn: BigInt(600), eventsOut: BigInt(300) }),
          makePipelineRow({ pipelineId: "p2", timestamp: t1, eventsIn: BigInt(1200), eventsOut: BigInt(600) }),
        ],
        nodeRows: [],
        filterOptions: emptyFilterOptions,
      });

      // Total eventsIn: (600 + 1200) / 60 = 30
      expect(Object.keys(result.pipeline.eventsIn)).toEqual(["Total"]);
      expect(result.pipeline.eventsIn["Total"]).toHaveLength(1);
      expect(result.pipeline.eventsIn["Total"]![0]!.v).toBe((600 + 1200) / 60);
    });

    it("averages system CPU/memory into a single 'Total' series", () => {
      const t1 = new Date("2025-01-01T00:00:00Z");
      const t2 = new Date("2025-01-01T00:01:00Z");

      const result = computeChartMetrics({
        range: "1h",
        groupBy: "aggregate",
        nodeNameMap: new Map([
          ["n1", "Node A"],
          ["n2", "Node B"],
        ]),
        pipelineNameMap: new Map(),
        pipelineRows: [],
        nodeRows: [
          // Node A: CPU 50% at t2, memory 40%
          makeNodeRow({ nodeId: "n1", timestamp: t1, cpuSecondsTotal: 100, cpuSecondsIdle: 50 }),
          makeNodeRow({ nodeId: "n1", timestamp: t2, cpuSecondsTotal: 200, cpuSecondsIdle: 100, memoryUsedBytes: BigInt(400), memoryTotalBytes: BigInt(1000) }),
          // Node B: CPU 80% at t2, memory 60%
          makeNodeRow({ nodeId: "n2", timestamp: t1, cpuSecondsTotal: 100, cpuSecondsIdle: 50 }),
          makeNodeRow({ nodeId: "n2", timestamp: t2, cpuSecondsTotal: 200, cpuSecondsIdle: 60, memoryUsedBytes: BigInt(600), memoryTotalBytes: BigInt(1000) }),
        ],
        filterOptions: emptyFilterOptions,
      });

      // avgSeries: average of per-node CPU % at t2
      // Node A CPU: (100 - 50) / 100 * 100 = 50%
      // Node B CPU: (100 - 10) / 100 * 100 = 90%... wait let me recalculate:
      // Node B: delta_total = 200-100=100, delta_idle=60-50=10 → (100-10)/100*100 = 90%
      // avgSeries → (50 + 90) / 2 = 70
      expect(result.system.cpu["Total"]).toHaveLength(1);
      expect(result.system.cpu["Total"]![0]!.v).toBe(70);
    });
  });

  describe("downsampling with range: 7d", () => {
    it("averages values into 5-minute buckets", () => {
      // 5 min = 300_000 ms. Create 3 points within a single 5-min bucket.
      const base = new Date("2025-01-01T00:00:00Z").getTime();
      const rows = [
        makePipelineRow({ pipelineId: "p1", timestamp: new Date(base), eventsIn: BigInt(60) }),
        makePipelineRow({ pipelineId: "p1", timestamp: new Date(base + 60_000), eventsIn: BigInt(120) }),
        makePipelineRow({ pipelineId: "p1", timestamp: new Date(base + 120_000), eventsIn: BigInt(180) }),
        // One point in the next bucket (5 min later)
        makePipelineRow({ pipelineId: "p1", timestamp: new Date(base + 300_000), eventsIn: BigInt(240) }),
      ];

      const result = computeChartMetrics({
        range: "7d",
        groupBy: "pipeline",
        nodeNameMap: new Map(),
        pipelineNameMap: new Map([["p1", "Pipeline"]]),
        pipelineRows: rows,
        nodeRows: [],
        filterOptions: emptyFilterOptions,
      });

      const series = result.pipeline.eventsIn["Pipeline"]!;
      expect(series).toHaveLength(2); // two buckets

      // First bucket: avg of (60/60, 120/60, 180/60) = avg(1, 2, 3) = 2
      expect(series[0]!.v).toBeCloseTo(2, 5);

      // Second bucket: 240/60 = 4
      expect(series[1]!.v).toBeCloseTo(4, 5);
    });
  });

  describe("empty rows", () => {
    it("produces empty output without errors", () => {
      const result = computeChartMetrics({
        range: "1h",
        groupBy: "pipeline",
        nodeNameMap: new Map(),
        pipelineNameMap: new Map(),
        pipelineRows: [],
        nodeRows: [],
        filterOptions: emptyFilterOptions,
      });

      expect(result.pipeline.eventsIn).toEqual({});
      expect(result.pipeline.eventsOut).toEqual({});
      expect(result.pipeline.bytesIn).toEqual({});
      expect(result.pipeline.errors).toEqual({});
      expect(result.system.cpu).toEqual({});
      expect(result.system.memory).toEqual({});
      expect(result.filterOptions).toEqual(emptyFilterOptions);
    });

    it("handles empty rows for all groupBy modes", () => {
      for (const groupBy of ["pipeline", "node", "aggregate"] as const) {
        const result = computeChartMetrics({
          range: "1h",
          groupBy,
          nodeNameMap: new Map(),
          pipelineNameMap: new Map(),
          pipelineRows: [],
          nodeRows: [],
          filterOptions: emptyFilterOptions,
        });
        expect(result.pipeline.eventsIn).toEqual({});
        // In aggregate mode, avgSeries/sumSeries produce { Total: [] } for empty input
        if (groupBy === "aggregate") {
          expect(result.system.cpu).toEqual({ Total: [] });
        } else {
          expect(result.system.cpu).toEqual({});
        }
      }
    });
  });

  describe("bigint handling", () => {
    it("correctly converts bigint fields to numeric values", () => {
      const t1 = new Date("2025-01-01T00:00:00Z");

      const result = computeChartMetrics({
        range: "1h",
        groupBy: "pipeline",
        nodeNameMap: new Map(),
        pipelineNameMap: new Map([["p1", "Test"]]),
        pipelineRows: [
          makePipelineRow({
            pipelineId: "p1",
            timestamp: t1,
            eventsIn: BigInt(6000),
            eventsOut: BigInt(3000),
            bytesIn: BigInt(120000),
            bytesOut: BigInt(60000),
            errorsTotal: BigInt(60),
            eventsDiscarded: BigInt(120),
          }),
        ],
        nodeRows: [],
        filterOptions: emptyFilterOptions,
      });

      // eventsIn: 6000 / 60 = 100
      expect(result.pipeline.eventsIn["Test"]![0]!.v).toBe(100);
      // eventsOut: 3000 / 60 = 50
      expect(result.pipeline.eventsOut["Test"]![0]!.v).toBe(50);
      // bytesIn: 120000 / 60 = 2000
      expect(result.pipeline.bytesIn["Test"]![0]!.v).toBe(2000);
      // errors: 60 / 60 = 1
      expect(result.pipeline.errors["Test"]![0]!.v).toBe(1);
      // discarded: 120 / 60 = 2
      expect(result.pipeline.discarded["Test"]![0]!.v).toBe(2);
    });

    it("handles large bigint values without precision loss", () => {
      const t1 = new Date("2025-01-01T00:00:00Z");

      const result = computeChartMetrics({
        range: "1h",
        groupBy: "pipeline",
        nodeNameMap: new Map(),
        pipelineNameMap: new Map([["p1", "Large"]]),
        pipelineRows: [
          makePipelineRow({
            pipelineId: "p1",
            timestamp: t1,
            bytesIn: BigInt(9007199254740000), // near Number.MAX_SAFE_INTEGER
          }),
        ],
        nodeRows: [],
        filterOptions: emptyFilterOptions,
      });

      expect(typeof result.pipeline.bytesIn["Large"]![0]!.v).toBe("number");
      expect(result.pipeline.bytesIn["Large"]![0]!.v).toBeGreaterThan(0);
    });

    it("handles bigint in node rows for memory fields", () => {
      const t1 = new Date("2025-01-01T00:00:00Z");
      const t2 = new Date("2025-01-01T00:01:00Z");

      const result = computeChartMetrics({
        range: "1h",
        groupBy: "node",
        nodeNameMap: new Map([["n1", "TestNode"]]),
        pipelineNameMap: new Map(),
        pipelineRows: [],
        nodeRows: [
          makeNodeRow({
            nodeId: "n1",
            timestamp: t1,
            memoryUsedBytes: BigInt(4294967296), // 4 GB
            memoryTotalBytes: BigInt(8589934592), // 8 GB
          }),
          makeNodeRow({
            nodeId: "n1",
            timestamp: t2,
            memoryUsedBytes: BigInt(6442450944), // 6 GB
            memoryTotalBytes: BigInt(8589934592), // 8 GB
          }),
        ],
        filterOptions: emptyFilterOptions,
      });

      // Memory at t2: 6GB / 8GB * 100 = 75%
      expect(result.system.memory["TestNode"]![0]!.v).toBeCloseTo(75, 1);
    });
  });

  describe("latency handling", () => {
    it("includes latency values when latencyMeanMs is provided", () => {
      const t1 = new Date("2025-01-01T00:00:00Z");

      const result = computeChartMetrics({
        range: "1h",
        groupBy: "pipeline",
        nodeNameMap: new Map(),
        pipelineNameMap: new Map([["p1", "Test"]]),
        pipelineRows: [
          makePipelineRow({ pipelineId: "p1", timestamp: t1, latencyMeanMs: 42.5 }),
        ],
        nodeRows: [],
        filterOptions: emptyFilterOptions,
      });

      expect(result.pipeline.latency["Test"]).toHaveLength(1);
      expect(result.pipeline.latency["Test"]![0]!.v).toBe(42.5);
    });

    it("omits latency entry when latencyMeanMs is null", () => {
      const t1 = new Date("2025-01-01T00:00:00Z");

      const result = computeChartMetrics({
        range: "1h",
        groupBy: "pipeline",
        nodeNameMap: new Map(),
        pipelineNameMap: new Map([["p1", "Test"]]),
        pipelineRows: [
          makePipelineRow({ pipelineId: "p1", timestamp: t1, latencyMeanMs: null }),
        ],
        nodeRows: [],
        filterOptions: emptyFilterOptions,
      });

      expect(result.pipeline.latency["Test"]).toBeUndefined();
    });
  });

  describe("filterOptions passthrough", () => {
    it("returns filterOptions unchanged", () => {
      const filterOptions = {
        nodes: [{ id: "n1", name: "Node 1" }],
        pipelines: [{ id: "p1", name: "Pipeline 1" }],
      };

      const result = computeChartMetrics({
        range: "1h",
        groupBy: "pipeline",
        nodeNameMap: new Map(),
        pipelineNameMap: new Map(),
        pipelineRows: [],
        nodeRows: [],
        filterOptions,
      });

      expect(result.filterOptions).toBe(filterOptions);
    });
  });
});
