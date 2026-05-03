// src/server/services/__tests__/cost-attribution.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import {
  getCostSummary,
  getCostByPipeline,
  getCostByTeam,
  getCostByEnvironment,
  getCostTimeSeries,
  getPipelineCostSnapshot,
  formatCostCsv,
  computeCostCents,
} from "@/server/services/cost-attribution";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

describe("computeCostCents", () => {
  it("returns 0 when costPerGbCents is 0", () => {
    expect(computeCostCents(5_000_000_000, 0)).toBe(0);
  });

  it("calculates cost correctly for 1 GB at 100 cents/GB", () => {
    const oneGb = 1_073_741_824; // 1 GiB in bytes
    expect(computeCostCents(oneGb, 100)).toBe(100);
  });

  it("calculates cost correctly for 2.5 GB at 50 cents/GB", () => {
    const twoPointFiveGb = 2.5 * 1_073_741_824;
    expect(computeCostCents(twoPointFiveGb, 50)).toBe(125);
  });

  it("returns 0 for zero bytes", () => {
    expect(computeCostCents(0, 100)).toBe(0);
  });

  it("handles sub-GB amounts with correct rounding", () => {
    const halfGb = 536_870_912; // 0.5 GiB
    // 0.5 * 100 = 50
    expect(computeCostCents(halfGb, 100)).toBe(50);
  });
});

describe("getCostSummary", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("returns aggregated bytes with cost estimate for given range", async () => {
    prismaMock.pipelineMetric.aggregate.mockResolvedValueOnce({
      _sum: { bytesIn: BigInt(2_000_000_000), bytesOut: BigInt(1_500_000_000) },
      _count: { id: 10 },
      _avg: {},
      _min: {},
      _max: {},
    } as never);

    // Previous period
    prismaMock.pipelineMetric.aggregate.mockResolvedValueOnce({
      _sum: { bytesIn: BigInt(1_800_000_000), bytesOut: BigInt(1_400_000_000) },
      _count: { id: 8 },
      _avg: {},
      _min: {},
      _max: {},
    } as never);

    const result = await getCostSummary({
      environmentId: "env-1",
      range: "1d",
      costPerGbCents: 100,
    });

    expect(result.current.bytesIn).toBe(2_000_000_000);
    expect(result.current.bytesOut).toBe(1_500_000_000);
    expect(result.current.costCents).toBeGreaterThan(0);
    expect(result.previous.bytesIn).toBe(1_800_000_000);
    expect(result.previous.bytesOut).toBe(1_400_000_000);
  });

  it("returns zero cost when costPerGbCents is 0", async () => {
    prismaMock.pipelineMetric.aggregate.mockResolvedValue({
      _sum: { bytesIn: BigInt(2_000_000_000), bytesOut: BigInt(1_500_000_000) },
      _count: { id: 10 },
      _avg: {},
      _min: {},
      _max: {},
    } as never);

    const result = await getCostSummary({
      environmentId: "env-1",
      range: "1d",
      costPerGbCents: 0,
    });

    expect(result.current.costCents).toBe(0);
  });
});

describe("getCostByPipeline", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("returns per-pipeline breakdown with cost estimates", async () => {
    // @ts-expect-error - groupBy mock typing is complex
    prismaMock.pipelineMetric.groupBy.mockResolvedValue([
      {
        pipelineId: "p1",
        _sum: { bytesIn: BigInt(1_000_000_000), bytesOut: BigInt(800_000_000) },
      },
      {
        pipelineId: "p2",
        _sum: { bytesIn: BigInt(500_000_000), bytesOut: BigInt(300_000_000) },
      },
    ] as never);

    prismaMock.pipeline.findMany.mockResolvedValue([
      {
        id: "p1",
        name: "Logs Pipeline",
        environmentId: "env-1",
        environment: { id: "env-1", name: "Production", teamId: "team-1", team: { id: "team-1", name: "Platform" } },
      },
      {
        id: "p2",
        name: "Metrics Pipeline",
        environmentId: "env-1",
        environment: { id: "env-1", name: "Production", teamId: "team-1", team: { id: "team-1", name: "Platform" } },
      },
    ] as never);

    const result = await getCostByPipeline({
      environmentId: "env-1",
      range: "1d",
      costPerGbCents: 100,
    });

    expect(result).toHaveLength(2);
    expect(result[0].pipelineId).toBe("p1");
    expect(result[0].pipelineName).toBe("Logs Pipeline");
    expect(result[0].bytesIn).toBe(1_000_000_000);
    expect(result[0].bytesOut).toBe(800_000_000);
    expect(result[0].reductionPercent).toBeCloseTo(20.0, 0);
    expect(result[0].costCents).toBeGreaterThan(0);
    expect(result[0].teamName).toBe("Platform");
    expect(result[0].environmentName).toBe("Production");
  });

  it("returns empty array when no metrics exist", async () => {
    // @ts-expect-error - groupBy mock typing is complex
    prismaMock.pipelineMetric.groupBy.mockResolvedValue([] as never);
    prismaMock.pipeline.findMany.mockResolvedValue([] as never);

    const result = await getCostByPipeline({
      environmentId: "env-1",
      range: "1d",
      costPerGbCents: 100,
    });

    expect(result).toEqual([]);
  });
});

describe("getCostByTeam", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("aggregates pipeline costs by team", async () => {
    // @ts-expect-error - groupBy mock typing is complex
    prismaMock.pipelineMetric.groupBy.mockResolvedValue([
      {
        pipelineId: "p1",
        _sum: { bytesIn: BigInt(1_000_000_000), bytesOut: BigInt(800_000_000) },
      },
      {
        pipelineId: "p2",
        _sum: { bytesIn: BigInt(500_000_000), bytesOut: BigInt(300_000_000) },
      },
    ] as never);

    prismaMock.pipeline.findMany.mockResolvedValue([
      {
        id: "p1",
        name: "Logs",
        environmentId: "env-1",
        environment: {
          id: "env-1",
          name: "Production",
          teamId: "team-1",
          team: { id: "team-1", name: "Platform" },
          costPerGbCents: 100,
        },
      },
      {
        id: "p2",
        name: "Metrics",
        environmentId: "env-1",
        environment: {
          id: "env-1",
          name: "Production",
          teamId: "team-1",
          team: { id: "team-1", name: "Platform" },
          costPerGbCents: 100,
        },
      },
    ] as never);

    const result = await getCostByTeam({
      teamIds: ["team-1"],
      range: "30d",
    });

    expect(result).toHaveLength(1);
    expect(result[0].teamName).toBe("Platform");
    expect(result[0].bytesIn).toBe(1_500_000_000);
    expect(result[0].pipelineCount).toBe(2);
  });
});

describe("getCostByEnvironment", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("aggregates pipeline costs by environment", async () => {
    prismaMock.environment.findMany.mockResolvedValue([
      { id: "env-1", name: "Production", costPerGbCents: 100, teamId: "t1" },
      { id: "env-2", name: "Staging", costPerGbCents: 50, teamId: "t1" },
    ] as never);

    // Production metrics
    prismaMock.pipelineMetric.aggregate
      .mockResolvedValueOnce({
        _sum: { bytesIn: BigInt(10_000_000_000), bytesOut: BigInt(8_000_000_000) },
        _count: { id: 100 },
        _avg: {},
        _min: {},
        _max: {},
      } as never)
      // Staging metrics
      .mockResolvedValueOnce({
        _sum: { bytesIn: BigInt(2_000_000_000), bytesOut: BigInt(1_500_000_000) },
        _count: { id: 20 },
        _avg: {},
        _min: {},
        _max: {},
      } as never);

    const result = await getCostByEnvironment({
      environmentIds: ["env-1", "env-2"],
      range: "30d",
    });

    expect(result).toHaveLength(2);
    expect(result[0].environmentName).toBe("Production");
    expect(result[0].bytesIn).toBe(10_000_000_000);
    // Production cost should be higher due to higher rate
    expect(result[0].costCents).toBeGreaterThan(result[1].costCents);
  });
});

describe("getCostTimeSeries", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("returns bucketed time series with cost per bucket", async () => {
    const baseTime = new Date("2026-03-28T00:00:00Z").getTime();
    prismaMock.pipelineMetric.findMany.mockResolvedValue([
      {
        pipelineId: "p1",
        timestamp: new Date(baseTime),
        bytesIn: BigInt(500_000_000),
        bytesOut: BigInt(400_000_000),
      },
      {
        pipelineId: "p1",
        timestamp: new Date(baseTime + 3_600_000),
        bytesIn: BigInt(600_000_000),
        bytesOut: BigInt(450_000_000),
      },
      {
        pipelineId: "p2",
        timestamp: new Date(baseTime),
        bytesIn: BigInt(200_000_000),
        bytesOut: BigInt(150_000_000),
      },
    ] as never);

    prismaMock.pipeline.findMany.mockResolvedValue([
      { id: "p1", name: "Logs", environment: { team: { name: "Platform" } } },
      { id: "p2", name: "Metrics", environment: { team: { name: "Platform" } } },
    ] as never);

    const result = await getCostTimeSeries({
      environmentId: "env-1",
      range: "1d",
      costPerGbCents: 100,
      groupBy: "pipeline",
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("bucket");
    // Should have per-pipeline series
    expect(result[0]).toHaveProperty("series");
  });
});

describe("formatCostCsv", () => {
  it("generates valid CSV with headers", () => {
    const rows = [
      {
        pipelineId: "p1",
        pipelineName: "Logs Pipeline",
        teamName: "Platform",
        environmentName: "Production",
        bytesIn: 1_000_000_000,
        bytesOut: 800_000_000,
        reductionPercent: 20,
        costCents: 93,
      },
    ];

    const csv = formatCostCsv(rows);
    const lines = csv.split("\n");

    expect(lines[0]).toBe(
      "Pipeline,Team,Environment,Bytes In,Bytes Out,Reduction %,Cost ($)"
    );
    expect(lines[1]).toContain("Logs Pipeline");
    expect(lines[1]).toContain("Platform");
    expect(lines[1]).toContain("Production");
    expect(lines[1]).toContain("0.93"); // 93 cents = $0.93
  });

  it("escapes commas in pipeline names", () => {
    const rows = [
      {
        pipelineId: "p1",
        pipelineName: "Logs, Events, and More",
        teamName: "Platform",
        environmentName: "Production",
        bytesIn: 1_000_000_000,
        bytesOut: 800_000_000,
        reductionPercent: 20,
        costCents: 93,
      },
    ];

    const csv = formatCostCsv(rows);
    const lines = csv.split("\n");

    // Name with comma should be quoted
    expect(lines[1]).toContain('"Logs, Events, and More"');
  });

  it("returns only headers when no rows", () => {
    const csv = formatCostCsv([]);
    const lines = csv.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
  });
});

describe("getPipelineCostSnapshot", () => {
  beforeEach(() => mockReset(prismaMock));

  it("returns aggregated bytes and cost for a single pipeline", async () => {
    prismaMock.pipelineMetric.aggregate.mockResolvedValue({
      _sum: { bytesIn: BigInt(2_000_000_000), bytesOut: BigInt(500_000_000) },
    } as never);

    const result = await getPipelineCostSnapshot("pipe-1", 100, "1d");

    expect(result.bytesIn).toBe(2_000_000_000);
    expect(result.bytesOut).toBe(500_000_000);
    expect(result.reductionPercent).toBeCloseTo(75, 1);
    // 2_000_000_000 bytes = ~1.86 GB; 1.86 * 100 cents ≈ 186
    expect(result.costCents).toBeGreaterThan(180);
    expect(result.costCents).toBeLessThan(200);
    expect(result.periodHours).toBe(24);
  });

  it("returns zero bytes and null reductionPercent when no metrics exist", async () => {
    prismaMock.pipelineMetric.aggregate.mockResolvedValue({
      _sum: { bytesIn: null, bytesOut: null },
    } as never);

    const result = await getPipelineCostSnapshot("pipe-1", 100, "1d");

    expect(result.bytesIn).toBe(0);
    expect(result.bytesOut).toBe(0);
    expect(result.reductionPercent).toBeNull();
    expect(result.costCents).toBe(0);
  });

  it("returns zero cost when costPerGbCents is 0 even with bytes processed", async () => {
    prismaMock.pipelineMetric.aggregate.mockResolvedValue({
      _sum: { bytesIn: BigInt(5_000_000_000), bytesOut: BigInt(5_000_000_000) },
    } as never);

    const result = await getPipelineCostSnapshot("pipe-1", 0, "1d");

    expect(result.costCents).toBe(0);
    expect(result.bytesIn).toBe(5_000_000_000);
  });
});
