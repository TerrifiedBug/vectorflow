import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    pipelineMetric: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    nodeMetric: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/server/services/timescaledb", () => ({
  isTimescaleDbAvailable: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { isTimescaleDbAvailable } from "@/server/services/timescaledb";
import {
  resolveMetricsSource,
  queryPipelineMetricsAggregated,
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
});
