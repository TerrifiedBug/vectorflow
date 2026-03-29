import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/drift-metrics", () => ({
  getExpectedChecksums: vi.fn().mockReturnValue(new Map()),
}));

import { prisma } from "@/lib/prisma";
import {
  getFleetOverview,
  getVolumeTrend,
  getNodeThroughput,
  getNodeCapacity,
  getDataLoss,
  getMatrixThroughput,
  type TimeRange,
} from "@/server/services/fleet-data";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockQueryRaw = prismaMock.$queryRaw as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockReset(prismaMock);
});

describe("getFleetOverview", () => {
  /** Mock the additional drift queries that getFleetOverview now runs. */
  function mockDriftQueries() {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([]);
    prismaMock.pipeline.findMany.mockResolvedValue([]);
  }

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
    mockDriftQueries();

    const result = await getFleetOverview("env-1", "7d");

    expect(result).toEqual({
      bytesIn: 1000,
      bytesOut: 800,
      eventsIn: 500,
      eventsOut: 490,
      errorRate: 10 / 500,
      nodeCount: 3,
      versionDriftCount: 0,
      configDriftCount: 0,
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
    mockDriftQueries();

    const result = await getFleetOverview("env-1", "1d");

    expect(result).toEqual({
      bytesIn: 0,
      bytesOut: 0,
      eventsIn: 0,
      eventsOut: 0,
      errorRate: 0,
      nodeCount: 0,
      versionDriftCount: 0,
      configDriftCount: 0,
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
    mockDriftQueries();

    const result = await getFleetOverview("env-1", "1h");

    expect(result.errorRate).toBe(0.1);
  });

  it("returns versionDriftCount when nodes run non-latest versions", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([
        {
          bytes_in: BigInt(1000),
          bytes_out: BigInt(800),
          events_in: BigInt(100),
          events_out: BigInt(90),
          errors_total: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([{ count: BigInt(3) }]);

    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      { nodeId: "node-1", pipelineId: "pipe-1", version: 4, configChecksum: null },
      { nodeId: "node-2", pipelineId: "pipe-1", version: 5, configChecksum: null },
    ] as never);
    prismaMock.pipeline.findMany.mockResolvedValue([
      { id: "pipe-1", versions: [{ version: 5 }] },
    ] as never);

    const result = await getFleetOverview("env-1", "1d");
    expect(result.versionDriftCount).toBe(1);
    expect(result.configDriftCount).toBe(0);
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

describe("getNodeThroughput", () => {
  it("returns per-node throughput with BigInt conversion", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      {
        node_id: "node-1",
        node_name: "us-east-1",
        bytes_in: BigInt(50000),
        bytes_out: BigInt(45000),
        events_in: BigInt(1000),
        events_out: BigInt(980),
      },
      {
        node_id: "node-2",
        node_name: "eu-west-1",
        bytes_in: BigInt(30000),
        bytes_out: BigInt(28000),
        events_in: BigInt(600),
        events_out: BigInt(590),
      },
    ]);

    const result = await getNodeThroughput("env-1", "1d");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      nodeId: "node-1",
      nodeName: "us-east-1",
      bytesIn: 50000,
      bytesOut: 45000,
      eventsIn: 1000,
      eventsOut: 980,
    });
    expect(result[1]).toEqual({
      nodeId: "node-2",
      nodeName: "eu-west-1",
      bytesIn: 30000,
      bytesOut: 28000,
      eventsIn: 600,
      eventsOut: 590,
    });
  });

  it("returns empty array when no nodes have metrics", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);

    const result = await getNodeThroughput("env-1", "7d");

    expect(result).toEqual([]);
  });

  it("handles null metric values", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      {
        node_id: "node-1",
        node_name: "node-a",
        bytes_in: null,
        bytes_out: null,
        events_in: null,
        events_out: null,
      },
    ]);

    const result = await getNodeThroughput("env-1", "1h");

    expect(result[0]).toEqual({
      nodeId: "node-1",
      nodeName: "node-a",
      bytesIn: 0,
      bytesOut: 0,
      eventsIn: 0,
      eventsOut: 0,
    });
  });
});

describe("getNodeCapacity", () => {
  it("returns per-node bucketed capacity utilization", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      {
        node_id: "node-1",
        node_name: "us-east-1",
        bucket: new Date("2026-03-25T10:00:00Z"),
        memory_pct: 72.5,
        disk_pct: 45.3,
        cpu_load: 1.25,
      },
      {
        node_id: "node-1",
        node_name: "us-east-1",
        bucket: new Date("2026-03-25T11:00:00Z"),
        memory_pct: 75.0,
        disk_pct: 45.5,
        cpu_load: 1.80,
      },
      {
        node_id: "node-2",
        node_name: "eu-west-1",
        bucket: new Date("2026-03-25T10:00:00Z"),
        memory_pct: 60.0,
        disk_pct: 30.0,
        cpu_load: 0.50,
      },
    ]);

    const result = await getNodeCapacity("env-1", "1d");

    expect(result).toHaveLength(2);
    expect(result[0].nodeId).toBe("node-1");
    expect(result[0].nodeName).toBe("us-east-1");
    expect(result[0].buckets).toHaveLength(2);
    expect(result[0].buckets[0]).toEqual({
      bucket: "2026-03-25T10:00:00.000Z",
      memoryPct: 72.5,
      diskPct: 45.3,
      cpuLoad: 1.25,
    });
    expect(result[1].nodeId).toBe("node-2");
    expect(result[1].buckets).toHaveLength(1);
  });

  it("returns empty array when no node metrics exist", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);

    const result = await getNodeCapacity("env-1", "7d");

    expect(result).toEqual([]);
  });

  it("handles null utilization values", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      {
        node_id: "node-1",
        node_name: "node-a",
        bucket: new Date("2026-03-25T00:00:00Z"),
        memory_pct: null,
        disk_pct: null,
        cpu_load: null,
      },
    ]);

    const result = await getNodeCapacity("env-1", "1d");

    expect(result[0].buckets[0]).toEqual({
      bucket: "2026-03-25T00:00:00.000Z",
      memoryPct: 0,
      diskPct: 0,
      cpuLoad: 0,
    });
  });
});

describe("getDataLoss", () => {
  it("returns pipelines exceeding the loss threshold", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      {
        pipeline_id: "p1",
        pipeline_name: "ingest-logs",
        events_in: BigInt(1000),
        events_out: BigInt(800),
        events_discarded: BigInt(0), // 20% actual loss
      },
      {
        pipeline_id: "p2",
        pipeline_name: "metrics-agg",
        events_in: BigInt(500),
        events_out: BigInt(490),
        events_discarded: BigInt(0), // 2% loss
      },
    ]);

    const result = await getDataLoss("env-1", "1d", 0.05);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      pipelineId: "p1",
      pipelineName: "ingest-logs",
      eventsIn: 1000,
      eventsOut: 800,
      eventsDiscarded: 0,
      lossRate: 0.2,
    });
  });

  it("skips pipelines with zero throughput", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      {
        pipeline_id: "p1",
        pipeline_name: "idle-pipeline",
        events_in: BigInt(0),
        events_out: BigInt(0),
        events_discarded: BigInt(0),
      },
    ]);

    const result = await getDataLoss("env-1", "7d", 0.05);

    expect(result).toEqual([]);
  });

  it("returns empty array when no data loss detected", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      {
        pipeline_id: "p1",
        pipeline_name: "healthy",
        events_in: BigInt(1000),
        events_out: BigInt(999),
        events_discarded: BigInt(0), // 0.1% loss
      },
    ]);

    const result = await getDataLoss("env-1", "1d", 0.05);

    expect(result).toEqual([]);
  });

  it("sorts results by loss rate descending", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      {
        pipeline_id: "p1",
        pipeline_name: "moderate-loss",
        events_in: BigInt(1000),
        events_out: BigInt(850),
        events_discarded: BigInt(0), // 15% loss
      },
      {
        pipeline_id: "p2",
        pipeline_name: "severe-loss",
        events_in: BigInt(1000),
        events_out: BigInt(500),
        events_discarded: BigInt(0), // 50% loss
      },
    ]);

    const result = await getDataLoss("env-1", "1d", 0.05);

    expect(result).toHaveLength(2);
    expect(result[0].pipelineName).toBe("severe-loss");
    expect(result[1].pipelineName).toBe("moderate-loss");
  });
});

describe("getMatrixThroughput", () => {
  it("returns per-cell throughput rates and loss", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      {
        pipeline_id: "p1",
        node_id: "node-1",
        events_in: BigInt(86400), // 1 evt/sec over 1d
        events_out: BigInt(82080), // 5% loss
        bytes_in: BigInt(864000),
        bytes_out: BigInt(820800),
      },
    ]);

    const result = await getMatrixThroughput("env-1", "1d");

    expect(result).toHaveLength(1);
    expect(result[0].pipelineId).toBe("p1");
    expect(result[0].nodeId).toBe("node-1");
    expect(result[0].eventsPerSec).toBe(1);
    expect(result[0].lossRate).toBe(0.05);
    expect(result[0].bytesPerSec).toBe(
      Math.round((864000 + 820800) / 86400)
    );
  });

  it("returns empty array when no metrics exist", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);

    const result = await getMatrixThroughput("env-1", "7d");

    expect(result).toEqual([]);
  });

  it("handles zero events gracefully", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      {
        pipeline_id: "p1",
        node_id: "node-1",
        events_in: BigInt(0),
        events_out: BigInt(0),
        bytes_in: BigInt(0),
        bytes_out: BigInt(0),
      },
    ]);

    const result = await getMatrixThroughput("env-1", "1d");

    expect(result[0].eventsPerSec).toBe(0);
    expect(result[0].lossRate).toBe(0);
  });
});
