import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: vi.fn() },
}));

import { prisma } from "@/lib/prisma";
import {
  getFleetOverview,
  getVolumeTrend,
  type TimeRange,
} from "@/server/services/fleet-data";

const mockQueryRaw = prisma.$queryRaw as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getFleetOverview", () => {
  it("returns computed KPIs from aggregated metrics", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([
        {
          bytes_in: BigInt(1000),
          bytes_out: BigInt(800),
          events_in: BigInt(500),
          events_out: BigInt(490),
          errors_total: BigInt(10),
        },
      ])
      .mockResolvedValueOnce([{ count: BigInt(3) }]);

    const result = await getFleetOverview("env-1", "7d");

    expect(result).toEqual({
      bytesIn: 1000,
      bytesOut: 800,
      eventsIn: 500,
      eventsOut: 490,
      errorRate: 10 / 500,
      nodeCount: 3,
    });
  });

  it("returns zeros when no data exists", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([
        {
          bytes_in: null,
          bytes_out: null,
          events_in: null,
          events_out: null,
          errors_total: null,
        },
      ])
      .mockResolvedValueOnce([{ count: BigInt(0) }]);

    const result = await getFleetOverview("env-1", "1d");

    expect(result).toEqual({
      bytesIn: 0,
      bytesOut: 0,
      eventsIn: 0,
      eventsOut: 0,
      errorRate: 0,
      nodeCount: 0,
    });
  });

  it("computes error rate as errorsTotal / eventsIn", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([
        {
          bytes_in: BigInt(0),
          bytes_out: BigInt(0),
          events_in: BigInt(200),
          events_out: BigInt(180),
          errors_total: BigInt(20),
        },
      ])
      .mockResolvedValueOnce([{ count: BigInt(1) }]);

    const result = await getFleetOverview("env-1", "1h");

    expect(result.errorRate).toBe(0.1);
  });
});

describe("getVolumeTrend", () => {
  it("returns daily-bucketed volume data with number conversion", async () => {
    const buckets = [
      {
        bucket: new Date("2026-03-24T00:00:00Z"),
        bytes_in: BigInt(500),
        bytes_out: BigInt(400),
        events_in: BigInt(100),
        events_out: BigInt(90),
      },
      {
        bucket: new Date("2026-03-25T00:00:00Z"),
        bytes_in: BigInt(600),
        bytes_out: BigInt(500),
        events_in: BigInt(120),
        events_out: BigInt(110),
      },
      {
        bucket: new Date("2026-03-26T00:00:00Z"),
        bytes_in: BigInt(700),
        bytes_out: BigInt(600),
        events_in: BigInt(140),
        events_out: BigInt(130),
      },
    ];
    mockQueryRaw.mockResolvedValueOnce(buckets);

    const result = await getVolumeTrend("env-1", "7d");

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      bucket: "2026-03-24T00:00:00.000Z",
      bytesIn: 500,
      bytesOut: 400,
      eventsIn: 100,
      eventsOut: 90,
    });
    expect(result[2]).toEqual({
      bucket: "2026-03-26T00:00:00.000Z",
      bytesIn: 700,
      bytesOut: 600,
      eventsIn: 140,
      eventsOut: 130,
    });
  });

  it("returns empty array when no data exists", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);

    const result = await getVolumeTrend("env-1", "30d");

    expect(result).toEqual([]);
  });

  it("accepts all five range values", async () => {
    const ranges: TimeRange[] = ["1h", "6h", "1d", "7d", "30d"];
    for (const range of ranges) {
      mockQueryRaw.mockResolvedValueOnce([]);
      const result = await getVolumeTrend("env-1", range);
      expect(result).toEqual([]);
    }
    expect(mockQueryRaw).toHaveBeenCalledTimes(5);
  });
});
