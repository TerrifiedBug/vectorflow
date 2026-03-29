import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));
vi.mock("@/lib/logger", () => ({ debugLog: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { runCostAnalysis } from "@/server/services/cost-optimizer";

const prismaMock = prisma as unknown as ReturnType<typeof mockDeep<PrismaClient>>;

beforeEach(() => {
  mockReset(prismaMock);
});

describe("runCostAnalysis (integration)", () => {
  it("aggregates metrics and returns recommendations across all detectors", async () => {
    // Mock aggregated pipeline metrics
    prismaMock.pipelineMetric.groupBy.mockResolvedValue([
      {
        pipelineId: "pipe-low-reduction",
        _sum: {
          bytesIn: BigInt(10_000_000_000),
          bytesOut: BigInt(10_000_000_000),
          eventsIn: BigInt(1_000_000),
          eventsOut: BigInt(1_000_000),
          errorsTotal: BigInt(0),
          eventsDiscarded: BigInt(0),
        },
        _count: { id: 100 },
      },
      {
        pipelineId: "pipe-high-error",
        _sum: {
          bytesIn: BigInt(5_000_000_000),
          bytesOut: BigInt(4_000_000_000),
          eventsIn: BigInt(1000),
          eventsOut: BigInt(800),
          errorsTotal: BigInt(200),
          eventsDiscarded: BigInt(0),
        },
        _count: { id: 50 },
      },
    ] as never);

    // Mock pipeline lookup
    prismaMock.pipeline.findMany.mockResolvedValue([
      {
        id: "pipe-low-reduction",
        name: "Low Reduction Pipeline",
        environmentId: "env-1",
        environment: { teamId: "team-1" },
      },
      {
        id: "pipe-high-error",
        name: "High Error Pipeline",
        environmentId: "env-1",
        environment: { teamId: "team-1" },
      },
    ] as never);

    // Mock sink nodes (no duplicates)
    prismaMock.pipelineNode.findMany.mockResolvedValue([]);

    const results = await runCostAnalysis();

    // Should detect at least the low-reduction and high-error pipelines
    const types = results.map((r) => r.type);
    expect(types).toContain("LOW_REDUCTION");
    expect(types).toContain("HIGH_ERROR_RATE");
  });

  it("returns empty array when no pipelines have metrics", async () => {
    prismaMock.pipelineMetric.groupBy.mockResolvedValue([]);
    prismaMock.pipeline.findMany.mockResolvedValue([]);
    prismaMock.pipelineNode.findMany.mockResolvedValue([]);

    const results = await runCostAnalysis();
    expect(results).toHaveLength(0);
  });
});
