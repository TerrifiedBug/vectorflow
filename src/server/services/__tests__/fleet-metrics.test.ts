import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import {
  getFleetErrorRate,
  getFleetEventVolume,
  getFleetThroughputDrop,
  getNodeLoadImbalance,
  getPipelineLatencyMean,
  getPipelineThroughputFloor,
} from "@/server/services/fleet-metrics";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// ─── Helpers ────────────────────────────────────────────────────────────────

const ENV_ID = "env-1";

/** Shorthand for a NodePipelineStatus row fragment with BigInt fields. */
function nps(overrides: {
  nodeId?: string;
  eventsIn?: number;
  errorsTotal?: number;
  eventsDiscarded?: number;
}) {
  return {
    nodeId: overrides.nodeId ?? "node-1",
    eventsIn: BigInt(overrides.eventsIn ?? 0),
    errorsTotal: BigInt(overrides.errorsTotal ?? 0),
    eventsDiscarded: BigInt(overrides.eventsDiscarded ?? 0),
  };
}

/** Shorthand for a PipelineMetric row fragment. */
function pm(overrides: { eventsIn?: number }) {
  return {
    eventsIn: BigInt(overrides.eventsIn ?? 0),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockReset(prismaMock);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-06-01T12:00:00Z"));
});

// ─── getFleetErrorRate ──────────────────────────────────────────────────────

describe("getFleetErrorRate", () => {
  it("returns null when no pipeline data exists", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([]);
    expect(await getFleetErrorRate(ENV_ID)).toBeNull();
  });

  it("returns 0 for a single pipeline with no errors", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({ eventsIn: 1000, errorsTotal: 0 }),
    ] as never);
    expect(await getFleetErrorRate(ENV_ID)).toBe(0);
  });

  it("computes error rate for multiple pipelines with errors", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({ eventsIn: 1000, errorsTotal: 50 }),
      nps({ eventsIn: 500, errorsTotal: 25 }),
    ] as never);
    // (50+25) / (1000+500) * 100 = 75/1500 * 100 = 5
    expect(await getFleetErrorRate(ENV_ID)).toBe(5);
  });

  it("returns 0 when eventsIn is 0 (division by zero guard)", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({ eventsIn: 0, errorsTotal: 0 }),
    ] as never);
    expect(await getFleetErrorRate(ENV_ID)).toBe(0);
  });

  it("aggregates across nodes", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({ nodeId: "node-1", eventsIn: 2000, errorsTotal: 100 }),
      nps({ nodeId: "node-2", eventsIn: 3000, errorsTotal: 150 }),
    ] as never);
    // (100+150) / (2000+3000) * 100 = 250/5000 * 100 = 5
    expect(await getFleetErrorRate(ENV_ID)).toBe(5);
  });
});

// ─── getFleetEventVolume ────────────────────────────────────────────────────

describe("getFleetEventVolume", () => {
  it("returns null when no data exists", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([]);
    expect(await getFleetEventVolume(ENV_ID)).toBeNull();
  });

  it("returns volume for a single node", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({ eventsIn: 5000 }),
    ] as never);
    expect(await getFleetEventVolume(ENV_ID)).toBe(5000);
  });

  it("aggregates across multiple nodes", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({ nodeId: "node-1", eventsIn: 3000 }),
      nps({ nodeId: "node-2", eventsIn: 7000 }),
    ] as never);
    expect(await getFleetEventVolume(ENV_ID)).toBe(10000);
  });
});

// ─── getFleetThroughputDrop ─────────────────────────────────────────────────

describe("getFleetThroughputDrop", () => {
  it("returns null when no previous data exists", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({ eventsIn: 1000 }),
    ] as never);
    prismaMock.pipelineMetric.findMany.mockResolvedValue([]);
    expect(await getFleetThroughputDrop(ENV_ID)).toBeNull();
  });

  it("returns 0% when equal periods", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({ eventsIn: 1000 }),
    ] as never);
    prismaMock.pipelineMetric.findMany.mockResolvedValue([
      pm({ eventsIn: 1000 }),
    ] as never);
    expect(await getFleetThroughputDrop(ENV_ID)).toBe(0);
  });

  it("returns 50% when throughput drops by half", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({ eventsIn: 500 }),
    ] as never);
    prismaMock.pipelineMetric.findMany.mockResolvedValue([
      pm({ eventsIn: 1000 }),
    ] as never);
    // (1000 - 500) / 1000 * 100 = 50
    expect(await getFleetThroughputDrop(ENV_ID)).toBe(50);
  });

  it("returns negative value when throughput increases", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({ eventsIn: 1500 }),
    ] as never);
    prismaMock.pipelineMetric.findMany.mockResolvedValue([
      pm({ eventsIn: 1000 }),
    ] as never);
    // (1000 - 1500) / 1000 * 100 = -50
    expect(await getFleetThroughputDrop(ENV_ID)).toBe(-50);
  });

  it("returns 0 when previous period is zero", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({ eventsIn: 1000 }),
    ] as never);
    prismaMock.pipelineMetric.findMany.mockResolvedValue([
      pm({ eventsIn: 0 }),
    ] as never);
    expect(await getFleetThroughputDrop(ENV_ID)).toBe(0);
  });
});

// ─── getNodeLoadImbalance ───────────────────────────────────────────────────

describe("getNodeLoadImbalance", () => {
  it("returns null when no nodes exist", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([]);
    expect(await getNodeLoadImbalance(ENV_ID)).toBeNull();
  });

  it("returns null when only a single node exists", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({ nodeId: "node-1", eventsIn: 1000 }),
    ] as never);
    expect(await getNodeLoadImbalance(ENV_ID)).toBeNull();
  });

  it("returns 0% when two nodes have equal load", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({ nodeId: "node-1", eventsIn: 1000 }),
      nps({ nodeId: "node-2", eventsIn: 1000 }),
    ] as never);
    const result = await getNodeLoadImbalance(ENV_ID);
    expect(result).not.toBeNull();
    expect(result!.value).toBe(0);
  });

  it("detects when one node has 2x the load of others", async () => {
    // Node-1: 2000, Node-2: 1000 → average = 1500
    // Node-1 deviation: |2000-1500|/1500 = 33.33%
    // Node-2 deviation: |1000-1500|/1500 = 33.33%
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({ nodeId: "node-1", eventsIn: 2000 }),
      nps({ nodeId: "node-2", eventsIn: 1000 }),
    ] as never);
    const result = await getNodeLoadImbalance(ENV_ID);
    expect(result).not.toBeNull();
    expect(result!.value).toBeCloseTo(33.33, 1);
    // Either node could be "most imbalanced" since deviation is equal
    expect(["node-1", "node-2"]).toContain(result!.nodeId);
  });

  it("handles three nodes with varying load", async () => {
    // Node-1: 3000, Node-2: 1000, Node-3: 2000 → average = 2000
    // Node-1 deviation: |3000-2000|/2000 = 50%
    // Node-2 deviation: |1000-2000|/2000 = 50%
    // Node-3 deviation: |2000-2000|/2000 = 0%
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({ nodeId: "node-1", eventsIn: 3000 }),
      nps({ nodeId: "node-2", eventsIn: 1000 }),
      nps({ nodeId: "node-3", eventsIn: 2000 }),
    ] as never);
    const result = await getNodeLoadImbalance(ENV_ID);
    expect(result).not.toBeNull();
    expect(result!.value).toBeCloseTo(50, 1);
    // node-1 or node-2 both deviate by 50%
    expect(["node-1", "node-2"]).toContain(result!.nodeId);
  });

  it("handles zero-traffic nodes", async () => {
    // Node-1: 1000, Node-2: 0 → average = 500
    // Node-1 deviation: |1000-500|/500 = 100%
    // Node-2 deviation: |0-500|/500 = 100%
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({ nodeId: "node-1", eventsIn: 1000 }),
      nps({ nodeId: "node-2", eventsIn: 0 }),
    ] as never);
    const result = await getNodeLoadImbalance(ENV_ID);
    expect(result).not.toBeNull();
    expect(result!.value).toBeCloseTo(100, 1);
  });

  it("returns value: 0 when all nodes have zero traffic", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({ nodeId: "node-1", eventsIn: 0 }),
      nps({ nodeId: "node-2", eventsIn: 0 }),
    ] as never);
    const result = await getNodeLoadImbalance(ENV_ID);
    expect(result).not.toBeNull();
    expect(result!.value).toBe(0);
  });

  it("aggregates multiple pipelines per node", async () => {
    // Node-1 has 2 pipelines: 500 + 500 = 1000 total
    // Node-2 has 1 pipeline: 3000 total
    // Average = 2000
    // Node-1 deviation: |1000-2000|/2000 = 50%
    // Node-2 deviation: |3000-2000|/2000 = 50%
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({ nodeId: "node-1", eventsIn: 500 }),
      nps({ nodeId: "node-1", eventsIn: 500 }),
      nps({ nodeId: "node-2", eventsIn: 3000 }),
    ] as never);
    const result = await getNodeLoadImbalance(ENV_ID);
    expect(result).not.toBeNull();
    expect(result!.value).toBeCloseTo(50, 1);
  });
});

// ─── getPipelineLatencyMean ─────────────────────────────────────────────────

describe("getPipelineLatencyMean", () => {
  it("returns null when no rollup rows exist in the window", async () => {
    prismaMock.pipelineMetric.aggregate.mockResolvedValue({
      _count: 0,
      _avg: { latencyMeanMs: null },
    } as never);
    expect(await getPipelineLatencyMean("pipe-1")).toBeNull();
  });

  it("returns the average latency when rows exist", async () => {
    prismaMock.pipelineMetric.aggregate.mockResolvedValue({
      _count: 5,
      _avg: { latencyMeanMs: 312.5 },
    } as never);
    expect(await getPipelineLatencyMean("pipe-1")).toBe(312.5);
  });

  it("returns null when avg is null even with rows present", async () => {
    prismaMock.pipelineMetric.aggregate.mockResolvedValue({
      _count: 3,
      _avg: { latencyMeanMs: null },
    } as never);
    expect(await getPipelineLatencyMean("pipe-1")).toBeNull();
  });
});

// ─── getPipelineThroughputFloor ─────────────────────────────────────────────

describe("getPipelineThroughputFloor", () => {
  it("returns 0 when no rollup rows exist (so a `< 1` floor still fires)", async () => {
    prismaMock.pipelineMetric.aggregate.mockResolvedValue({
      _sum: { eventsIn: null },
    } as never);
    expect(await getPipelineThroughputFloor("pipe-1")).toBe(0);
  });

  it("converts total events into events per second across the 5-minute window", async () => {
    // 5 min window = 300 sec. 3000 events / 300s = 10 events/sec.
    prismaMock.pipelineMetric.aggregate.mockResolvedValue({
      _sum: { eventsIn: BigInt(3000) },
    } as never);
    expect(await getPipelineThroughputFloor("pipe-1")).toBe(10);
  });

  it("returns 0 when rows exist but eventsIn is zero", async () => {
    prismaMock.pipelineMetric.aggregate.mockResolvedValue({
      _sum: { eventsIn: BigInt(0) },
    } as never);
    expect(await getPipelineThroughputFloor("pipe-1")).toBe(0);
  });
});
