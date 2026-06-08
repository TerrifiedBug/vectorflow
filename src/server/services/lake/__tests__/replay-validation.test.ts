import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => {
  const __pm = mockDeep<PrismaClient>();
  return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
});

import { prisma } from "@/lib/prisma";
import {
  evaluateReplayValidation,
  REPLAY_GATED_METRICS,
} from "@/server/services/lake/replay-validation";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const FROM = new Date("2026-03-01T00:00:00Z");
const TO = new Date("2026-03-01T01:00:00Z");

function makeSli(overrides: { metric: string; condition?: string; threshold?: number }) {
  return {
    id: `sli-${overrides.metric}`,
    pipelineId: "p1",
    metric: overrides.metric,
    condition: overrides.condition ?? "lt",
    threshold: overrides.threshold ?? 0.05,
    windowMinutes: 5,
    enabled: true,
    createdAt: new Date(),
  };
}

function aggregateResult(sum: {
  eventsIn: number | null;
  errorsTotal?: number;
  eventsDiscarded?: number;
}, count: number) {
  return {
    _sum: {
      eventsIn: sum.eventsIn === null ? null : BigInt(sum.eventsIn),
      errorsTotal: BigInt(sum.errorsTotal ?? 0),
      eventsDiscarded: BigInt(sum.eventsDiscarded ?? 0),
    },
    _count: count,
  } as never;
}

describe("evaluateReplayValidation", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("returns NO_DATA without touching the DB when the replay has no window", async () => {
    const result = await evaluateReplayValidation({
      targetPipelineId: "p1",
      startedAt: null,
      completedAt: null,
    });

    expect(result).toEqual({ verdict: "NO_DATA", slis: [], window: null });
    expect(prismaMock.pipelineSli.findMany).not.toHaveBeenCalled();
    expect(prismaMock.pipelineMetric.aggregate).not.toHaveBeenCalled();
  });

  it("PASSes when the candidate meets its SLIs over the replay window", async () => {
    prismaMock.pipelineSli.findMany.mockResolvedValue([makeSli({ metric: "error_rate" })] as never);
    // 10 / 1000 = 1% < 5% threshold → met
    prismaMock.pipelineMetric.aggregate.mockResolvedValue(
      aggregateResult({ eventsIn: 1000, errorsTotal: 10 }, 3),
    );

    const result = await evaluateReplayValidation({
      targetPipelineId: "p1",
      startedAt: FROM,
      completedAt: TO,
    });

    expect(result.verdict).toBe("PASS");
    expect(result.window).toEqual({ from: FROM.toISOString(), to: TO.toISOString() });
    // Scored strictly over the replay window, not a rolling one.
    expect(prismaMock.pipelineMetric.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ timestamp: { gte: FROM, lte: TO } }),
      }),
    );
  });

  it("FAILs when an SLI is breached over the replay window", async () => {
    prismaMock.pipelineSli.findMany.mockResolvedValue([makeSli({ metric: "error_rate" })] as never);
    // 200 / 1000 = 20% > 5% threshold → breached
    prismaMock.pipelineMetric.aggregate.mockResolvedValue(
      aggregateResult({ eventsIn: 1000, errorsTotal: 200 }, 3),
    );

    const result = await evaluateReplayValidation({
      targetPipelineId: "p1",
      startedAt: FROM,
      completedAt: TO,
    });

    expect(result.verdict).toBe("FAIL");
    expect(result.slis[0]).toEqual(
      expect.objectContaining({ metric: "error_rate", status: "breached" }),
    );
  });

  it("returns NO_DATA when the target has no replay-applicable SLIs", async () => {
    prismaMock.pipelineSli.findMany.mockResolvedValue([] as never);

    const result = await evaluateReplayValidation({
      targetPipelineId: "p1",
      startedAt: FROM,
      completedAt: TO,
    });

    expect(result.verdict).toBe("NO_DATA");
    expect(result.slis).toEqual([]);
    expect(prismaMock.pipelineMetric.aggregate).not.toHaveBeenCalled();
  });

  it("returns NO_DATA when no metrics landed in the replay window", async () => {
    prismaMock.pipelineSli.findMany.mockResolvedValue([makeSli({ metric: "error_rate" })] as never);
    prismaMock.pipelineMetric.aggregate.mockResolvedValue(aggregateResult({ eventsIn: null }, 0));

    const result = await evaluateReplayValidation({
      targetPipelineId: "p1",
      startedAt: FROM,
      completedAt: TO,
    });

    expect(result.verdict).toBe("NO_DATA");
  });

  it("only scores replay-applicable SLI metrics (excludes throughput_floor)", async () => {
    prismaMock.pipelineSli.findMany.mockResolvedValue([] as never);

    await evaluateReplayValidation({ targetPipelineId: "p1", startedAt: FROM, completedAt: TO });

    expect(prismaMock.pipelineSli.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ metric: { in: [...REPLAY_GATED_METRICS] } }),
      }),
    );
    expect(REPLAY_GATED_METRICS).not.toContain("throughput_floor");
  });
});
