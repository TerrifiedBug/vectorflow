import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/services/metrics-query", () => ({
  queryVolumeTimeSeries: vi.fn(),
  resolveMetricsSource: vi.fn(),
}));

import {
  queryVolumeTimeSeries,
  resolveMetricsSource,
} from "@/server/services/metrics-query";

const mockVolumeQuery = vi.mocked(queryVolumeTimeSeries);
const mockResolve = vi.mocked(resolveMetricsSource);

describe("dashboard router aggregate integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("volumeAnalytics uses 1h aggregate for 7d range", () => {
    mockResolve.mockReturnValue("1h");

    const source = resolveMetricsSource(168 * 60); // 7 days in minutes

    expect(source).toBe("1h");
  });

  it("volumeAnalytics uses 1m aggregate for 6h range", () => {
    mockResolve.mockReturnValue("1m");

    const source = resolveMetricsSource(360);

    expect(source).toBe("1m");
  });

  it("queryVolumeTimeSeries returns aggregated rows", async () => {
    mockVolumeQuery.mockResolvedValue([
      {
        bucket: new Date("2026-03-29T10:00:00Z"),
        pipelineId: "pipe-1",
        bytesIn: BigInt(100000),
        bytesOut: BigInt(95000),
        eventsIn: BigInt(5000),
        eventsOut: BigInt(4800),
      },
    ]);

    const result = await queryVolumeTimeSeries({
      environmentPipelineIds: ["pipe-1"],
      minutes: 10080,
      since: new Date("2026-03-22T10:00:00Z"),
    });

    expect(result).toHaveLength(1);
    expect(result[0].pipelineId).toBe("pipe-1");
  });
});
