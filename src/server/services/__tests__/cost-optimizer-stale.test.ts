import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import type { PipelineAggregates } from "@/server/services/cost-optimizer-types";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import { detectStalePipelines } from "@/server/services/cost-optimizer";

const prismaMock = prisma as unknown as ReturnType<typeof mockDeep<PrismaClient>>;

beforeEach(() => {
  mockReset(prismaMock);
});

function makeAgg(overrides: Partial<PipelineAggregates> = {}): PipelineAggregates {
  return {
    pipelineId: "pipe-1",
    pipelineName: "stale-pipeline",
    environmentId: "env-1",
    teamId: "team-1",
    totalBytesIn: BigInt(0),
    totalBytesOut: BigInt(0),
    totalEventsIn: BigInt(10),  // very low
    totalEventsOut: BigInt(10),
    totalErrors: BigInt(0),
    totalDiscarded: BigInt(0),
    metricCount: 5,
    ...overrides,
  };
}

describe("detectStalePipelines", () => {
  it("flags pipeline with low throughput deployed over 7 days ago", async () => {
    const agg = makeAgg();
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);

    prismaMock.pipeline.findMany.mockResolvedValue([
      { id: "pipe-1", name: "stale-pipeline", deployedAt: twentyDaysAgo },
    ] as never);

    const results = await detectStalePipelines([agg]);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("STALE_PIPELINE");
    expect(results[0].suggestedAction?.type).toBe("disable_pipeline");
  });

  it("does not flag recently deployed pipeline", async () => {
    const agg = makeAgg();

    // Deployed 2 days ago (under 7-day threshold)
    prismaMock.pipeline.findMany.mockResolvedValue([]);

    const results = await detectStalePipelines([agg]);
    expect(results).toHaveLength(0);
  });

  it("does not flag pipeline with reasonable throughput", async () => {
    const agg = makeAgg({
      totalEventsIn: BigInt(50_000), // well above stale threshold
    });

    const results = await detectStalePipelines([agg]);
    // Should not even query pipelines since throughput is above threshold
    expect(prismaMock.pipeline.findMany).not.toHaveBeenCalled();
    expect(results).toHaveLength(0);
  });
});
