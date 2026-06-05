import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => { const __pm = {
  $queryRawUnsafe: vi.fn(),
  pipelineMetric: {
    findMany: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
  },
  nodeMetric: {
    findMany: vi.fn(),
  },
  pipelineMetricRollup: { findMany: vi.fn() },
  nodeMetricRollup: { findMany: vi.fn() },
}; return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

vi.mock("@/server/services/timescaledb", () => ({
  isTimescaleDbAvailable: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { isTimescaleDbAvailable } from "@/server/services/timescaledb";
import {
  resolveMetricsSource,
  resolveRollupGranularity,
  queryEnvironmentPipelineMetricsAggregated,
  queryPipelineMetricsAggregated,
  queryNodeMetricsAggregated,
} from "../metrics-query";

const mockIsTimescale = vi.mocked(isTimescaleDbAvailable);
const mockQueryRaw = vi.mocked(prisma.$queryRawUnsafe);

describe("metrics-query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveMetricsSource", () => {
    it("returns raw table for ranges <= 60 minutes regardless of TimescaleDB", () => {
      mockIsTimescale.mockReturnValue(true);

      const source = resolveMetricsSource(60);

      expect(source).toBe("raw");
    });

    it("returns 1m aggregate for ranges 61-1440 minutes when TimescaleDB available", () => {
      mockIsTimescale.mockReturnValue(true);

      expect(resolveMetricsSource(360)).toBe("1m");
      expect(resolveMetricsSource(1440)).toBe("1m");
    });

    it("returns 1h aggregate for ranges > 1440 minutes when TimescaleDB available", () => {
      mockIsTimescale.mockReturnValue(true);

      expect(resolveMetricsSource(1441)).toBe("1h");
      expect(resolveMetricsSource(10080)).toBe("1h"); // 7 days
    });

    it("always returns raw when TimescaleDB not available", () => {
      mockIsTimescale.mockReturnValue(false);

      expect(resolveMetricsSource(60)).toBe("raw");
      expect(resolveMetricsSource(1440)).toBe("raw");
      expect(resolveMetricsSource(10080)).toBe("raw");
    });
  });

  describe("resolveRollupGranularity", () => {
    it("returns null within the raw-retention window (<= 7d)", () => {
      expect(resolveRollupGranularity(60)).toBeNull();
      expect(resolveRollupGranularity(1440)).toBeNull();
      expect(resolveRollupGranularity(7 * 24 * 60)).toBeNull(); // exactly 7d
    });

    it("returns HOUR just beyond raw retention (7d–14d)", () => {
      expect(resolveRollupGranularity(7 * 24 * 60 + 1)).toBe("HOUR");
      expect(resolveRollupGranularity(14 * 24 * 60)).toBe("HOUR"); // exactly 14d
    });

    it("returns DAY for very long ranges (> 14d)", () => {
      expect(resolveRollupGranularity(14 * 24 * 60 + 1)).toBe("DAY");
      expect(resolveRollupGranularity(43200)).toBe("DAY"); // 30d
    });
  });

  describe("queryPipelineMetricsAggregated", () => {
    it("queries continuous aggregate view for 6h range", async () => {
      mockIsTimescale.mockReturnValue(true);
      mockQueryRaw.mockResolvedValueOnce([
        {
          bucket: new Date("2026-03-29T10:00:00Z"),
          pipelineId: "pipe-1",
          events_in: BigInt(1000),
          events_out: BigInt(950),
          events_discarded: BigInt(10),
          errors_total: BigInt(5),
          bytes_in: BigInt(50000),
          bytes_out: BigInt(48000),
          avg_utilization: 0.75,
          avg_latency_ms: 12.5,
        },
      ]);

      const result = await queryPipelineMetricsAggregated({
        pipelineId: "pipe-1",
        minutes: 360,
      });

      expect(mockQueryRaw).toHaveBeenCalledTimes(1);
      const sql = mockQueryRaw.mock.calls[0][0] as string;
      expect(sql).toContain("pipeline_metrics_1m");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].eventsIn).toBe(BigInt(1000));
    });

    it("queries raw PipelineMetric table for 30min range", async () => {
      mockIsTimescale.mockReturnValue(true);
      vi.mocked(prisma.pipelineMetric.findMany).mockResolvedValueOnce([]);

      const result = await queryPipelineMetricsAggregated({
        pipelineId: "pipe-1",
        minutes: 30,
      });

      expect(prisma.pipelineMetric.findMany).toHaveBeenCalled();
      expect(mockQueryRaw).not.toHaveBeenCalled();
      expect(result.rows).toEqual([]);
    });

    it("falls back to raw query when TimescaleDB unavailable for 7d range", async () => {
      mockIsTimescale.mockReturnValue(false);
      vi.mocked(prisma.pipelineMetric.findMany).mockResolvedValueOnce([]);

      const result = await queryPipelineMetricsAggregated({
        pipelineId: "pipe-1",
        minutes: 10080,
      });

      expect(prisma.pipelineMetric.findMany).toHaveBeenCalled();
      expect(mockQueryRaw).not.toHaveBeenCalled();
      expect(result.rows).toEqual([]);
    });
  });

  describe("queryEnvironmentPipelineMetricsAggregated", () => {
    it("buckets raw environment metrics by minute before aggregating across pipelines", async () => {
      mockIsTimescale.mockReturnValue(true);
      mockQueryRaw.mockResolvedValueOnce([
        {
          bucket: new Date("2026-03-29T10:00:00Z"),
          events_in: BigInt(300),
          events_out: BigInt(290),
          events_discarded: BigInt(1),
          errors_total: BigInt(3),
          bytes_in: BigInt(3000),
          bytes_out: BigInt(2900),
          avg_utilization: 0.6,
          avg_latency_ms: 42,
        },
      ]);

      const result = await queryEnvironmentPipelineMetricsAggregated({
        environmentId: "env-1",
        minutes: 30,
      });

      expect(mockQueryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.pipelineMetric.groupBy).not.toHaveBeenCalled();
      const sql = mockQueryRaw.mock.calls[0][0] as string;
      expect(sql).toContain("date_trunc('minute'");
      expect(sql).toContain("JOIN \"Pipeline\"");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        timestamp: new Date("2026-03-29T10:00:00Z"),
        eventsIn: BigInt(300),
        eventsOut: BigInt(290),
        latencyMeanMs: 42,
      });
    });
  });

  describe("rollup read routing (long ranges)", () => {
    it("reads PipelineMetricRollup (DAY) for a 30-day pipeline range", async () => {
      // Rollups win for long ranges regardless of TimescaleDB availability.
      mockIsTimescale.mockReturnValue(true);
      vi.mocked(prisma.pipelineMetricRollup.findMany).mockResolvedValueOnce([
        {
          bucketStart: new Date("2026-03-01T00:00:00Z"),
          eventsIn: BigInt(1000),
          eventsOut: BigInt(900),
          eventsDiscarded: BigInt(10),
          errorsTotal: BigInt(5),
          bytesIn: BigInt(50000),
          bytesOut: BigInt(48000),
          utilization: 0.5,
          latencyMeanMs: 12,
        },
      ] as never);

      const result = await queryPipelineMetricsAggregated({
        pipelineId: "pipe-1",
        minutes: 43200, // 30 days
      });

      expect(prisma.pipelineMetricRollup.findMany).toHaveBeenCalledTimes(1);
      const call = vi.mocked(prisma.pipelineMetricRollup.findMany).mock.calls[0][0];
      expect(call?.where).toMatchObject({
        pipelineId: "pipe-1",
        componentId: "",
        granularity: "DAY",
      });
      // Raw + continuous-aggregate paths are bypassed entirely.
      expect(prisma.pipelineMetric.findMany).not.toHaveBeenCalled();
      expect(mockQueryRaw).not.toHaveBeenCalled();
      expect(result.rows).toEqual([
        {
          timestamp: new Date("2026-03-01T00:00:00Z"),
          eventsIn: BigInt(1000),
          eventsOut: BigInt(900),
          eventsDiscarded: BigInt(10),
          errorsTotal: BigInt(5),
          bytesIn: BigInt(50000),
          bytesOut: BigInt(48000),
          utilization: 0.5,
          latencyMeanMs: 12,
        },
      ]);
    });

    it("reads PipelineMetricRollup (HOUR) for a 10-day pipeline range", async () => {
      mockIsTimescale.mockReturnValue(true);
      vi.mocked(prisma.pipelineMetricRollup.findMany).mockResolvedValueOnce([] as never);

      await queryPipelineMetricsAggregated({
        pipelineId: "pipe-1",
        minutes: 14400, // 10 days (7d < range <= 14d -> HOUR)
      });

      const call = vi.mocked(prisma.pipelineMetricRollup.findMany).mock.calls[0][0];
      expect(call?.where).toMatchObject({ granularity: "HOUR" });
    });

    it("reads NodeMetricRollup for a long node range, mapping peak memory", async () => {
      mockIsTimescale.mockReturnValue(true);
      vi.mocked(prisma.nodeMetricRollup.findMany).mockResolvedValueOnce([
        {
          bucketStart: new Date("2026-03-01T00:00:00Z"),
          nodeId: "node-1",
          cpuSecondsTotal: 10,
          cpuSecondsIdle: 4,
          memoryUsedBytes: BigInt(100),
          memoryTotalBytes: BigInt(1000),
          maxMemoryUsedBytes: BigInt(500),
          diskReadBytes: BigInt(20),
          diskWrittenBytes: BigInt(30),
          netRxBytes: BigInt(40),
          netTxBytes: BigInt(50),
        },
      ] as never);

      const result = await queryNodeMetricsAggregated({
        nodeIds: ["node-1"],
        minutes: 43200,
      });

      expect(prisma.nodeMetricRollup.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.nodeMetric.findMany).not.toHaveBeenCalled();
      // memoryUsedBytes maps from the bucket peak (maxMemoryUsedBytes).
      expect(result.rows[0].memoryUsedBytes).toBe(BigInt(500));
      expect(result.rows[0].nodeId).toBe("node-1");
    });

    it("does NOT touch rollups for a short (1h) range", async () => {
      mockIsTimescale.mockReturnValue(false);
      vi.mocked(prisma.pipelineMetric.findMany).mockResolvedValueOnce([] as never);

      await queryPipelineMetricsAggregated({ pipelineId: "pipe-1", minutes: 60 });

      expect(prisma.pipelineMetricRollup.findMany).not.toHaveBeenCalled();
      expect(prisma.pipelineMetric.findMany).toHaveBeenCalled();
    });
  });
});
