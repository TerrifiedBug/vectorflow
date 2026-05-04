import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import { evaluatePipelineHealth } from "@/server/services/sli-evaluator";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

function makeSli(overrides: {
  metric: string;
  condition?: string;
  threshold?: number;
  windowMinutes?: number;
}) {
  return {
    id: `sli-${overrides.metric}`,
    pipelineId: "pipeline-1",
    metric: overrides.metric,
    condition: overrides.condition ?? "gt",
    threshold: overrides.threshold ?? 10,
    windowMinutes: overrides.windowMinutes ?? 5,
    enabled: true,
    createdAt: new Date(),
  };
}

describe("evaluatePipelineHealth", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("evaluates throughput and latency from cross-node aggregate metric rows only", async () => {
    prismaMock.pipelineSli.findMany.mockResolvedValue([
      makeSli({ metric: "throughput_floor", condition: "gt", threshold: 10, windowMinutes: 5 }),
      makeSli({ metric: "latency_mean", condition: "lt", threshold: 250, windowMinutes: 5 }),
    ]);

    prismaMock.pipelineMetric.aggregate.mockImplementation((args) => {
      const where = args.where as { nodeId?: string | null; latencyMeanMs?: { not: null } };
      const aggregateOnly = where.nodeId === null;

      if (where.latencyMeanMs) {
        return Promise.resolve({
          _avg: { latencyMeanMs: aggregateOnly ? 200 : 150 },
          _count: aggregateOnly ? 1 : 2,
        }) as never;
      }

      return Promise.resolve({
        _sum: {
          eventsIn: BigInt(aggregateOnly ? 6000 : 12000),
          errorsTotal: BigInt(0),
          eventsDiscarded: BigInt(0),
        },
        _count: aggregateOnly ? 1 : 2,
      }) as never;
    });

    const result = await evaluatePipelineHealth("pipeline-1");

    expect(result.status).toBe("healthy");
    expect(result.slis).toEqual([
      expect.objectContaining({
        metric: "throughput_floor",
        status: "met",
        value: 20,
      }),
      expect.objectContaining({
        metric: "latency_mean",
        status: "met",
        value: 200,
      }),
    ]);
  });
});
