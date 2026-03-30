import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/services/metrics-query", () => ({
  queryPipelineMetricsAggregated: vi.fn(),
  resolveMetricsSource: vi.fn(),
}));

import {
  queryPipelineMetricsAggregated,
  resolveMetricsSource,
} from "@/server/services/metrics-query";

const mockQuery = vi.mocked(queryPipelineMetricsAggregated);
const mockResolve = vi.mocked(resolveMetricsSource);

describe("metrics router aggregate integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolveMetricsSource returns 1m for 6-hour range", () => {
    mockResolve.mockReturnValue("1m");

    const source = resolveMetricsSource(360);

    expect(source).toBe("1m");
  });

  it("resolveMetricsSource returns 1h for 7-day range", () => {
    mockResolve.mockReturnValue("1h");

    const source = resolveMetricsSource(10080);

    expect(source).toBe("1h");
  });

  it("queryPipelineMetricsAggregated returns mapped rows", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          timestamp: new Date("2026-03-29T10:00:00Z"),
          eventsIn: BigInt(1000),
          eventsOut: BigInt(950),
          eventsDiscarded: BigInt(10),
          errorsTotal: BigInt(5),
          bytesIn: BigInt(50000),
          bytesOut: BigInt(48000),
          utilization: 0.75,
          latencyMeanMs: 12.5,
        },
      ],
    });

    const result = await queryPipelineMetricsAggregated({
      pipelineId: "pipe-1",
      minutes: 360,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].eventsIn).toBe(BigInt(1000));
  });
});
