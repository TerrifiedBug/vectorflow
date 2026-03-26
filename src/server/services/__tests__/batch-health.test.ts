import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── Module mocks ───────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

// ─── Import the mocked modules + SUT ───────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { batchEvaluatePipelineHealth } from "@/server/services/batch-health";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSli(overrides: {
  pipelineId: string;
  metric: string;
  condition?: string;
  threshold?: number;
  windowMinutes?: number;
}) {
  return {
    id: `sli-${overrides.pipelineId}-${overrides.metric}`,
    pipelineId: overrides.pipelineId,
    metric: overrides.metric,
    condition: overrides.condition ?? "lt",
    threshold: overrides.threshold ?? 0.05,
    windowMinutes: overrides.windowMinutes ?? 5,
    enabled: true,
    createdAt: new Date(),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("batchEvaluatePipelineHealth", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("returns empty object for empty pipelineIds", async () => {
    const result = await batchEvaluatePipelineHealth([]);
    expect(result).toEqual({});
    expect(prismaMock.pipelineSli.findMany).not.toHaveBeenCalled();
  });

  it("returns no_data for pipelines with no SLIs", async () => {
    prismaMock.pipelineSli.findMany.mockResolvedValue([]);

    const result = await batchEvaluatePipelineHealth(["p1", "p2"]);

    expect(result).toEqual({
      p1: { status: "no_data", slis: [] },
      p2: { status: "no_data", slis: [] },
    });
    // Should not query metrics when there are no SLIs
    expect(prismaMock.pipelineMetric.groupBy).not.toHaveBeenCalled();
  });

  describe("error_rate SLI", () => {
    it("evaluates as met when error rate is below threshold", async () => {
      prismaMock.pipelineSli.findMany.mockResolvedValue([
        makeSli({ pipelineId: "p1", metric: "error_rate", condition: "lt", threshold: 0.05 }),
      ]);

      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.pipelineMetric.groupBy.mockResolvedValue([
        {
          pipelineId: "p1",
          _sum: { eventsIn: BigInt(10000), errorsTotal: BigInt(100), eventsDiscarded: BigInt(0) },
          _count: 50,
        },
      ]);

      const result = await batchEvaluatePipelineHealth(["p1"]);

      expect(result.p1.status).toBe("healthy");
      expect(result.p1.slis).toHaveLength(1);
      expect(result.p1.slis[0]).toMatchObject({
        metric: "error_rate",
        status: "met",
        value: 0.01, // 100/10000
        threshold: 0.05,
      });
    });

    it("evaluates as breached when error rate exceeds threshold", async () => {
      prismaMock.pipelineSli.findMany.mockResolvedValue([
        makeSli({ pipelineId: "p1", metric: "error_rate", condition: "lt", threshold: 0.05 }),
      ]);

      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.pipelineMetric.groupBy.mockResolvedValue([
        {
          pipelineId: "p1",
          _sum: { eventsIn: BigInt(10000), errorsTotal: BigInt(1000), eventsDiscarded: BigInt(0) },
          _count: 50,
        },
      ]);

      const result = await batchEvaluatePipelineHealth(["p1"]);

      expect(result.p1.status).toBe("degraded");
      expect(result.p1.slis[0]).toMatchObject({
        metric: "error_rate",
        status: "breached",
        value: 0.1, // 1000/10000
      });
    });

    it("returns no_data when zero events (rate metrics)", async () => {
      prismaMock.pipelineSli.findMany.mockResolvedValue([
        makeSli({ pipelineId: "p1", metric: "error_rate" }),
      ]);

      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.pipelineMetric.groupBy.mockResolvedValue([
        {
          pipelineId: "p1",
          _sum: { eventsIn: BigInt(0), errorsTotal: BigInt(0), eventsDiscarded: BigInt(0) },
          _count: 5,
        },
      ]);

      const result = await batchEvaluatePipelineHealth(["p1"]);

      expect(result.p1.status).toBe("no_data");
      expect(result.p1.slis[0]).toMatchObject({
        metric: "error_rate",
        status: "no_data",
        value: null,
      });
    });
  });

  describe("discard_rate SLI", () => {
    it("evaluates discard rate correctly", async () => {
      prismaMock.pipelineSli.findMany.mockResolvedValue([
        makeSli({ pipelineId: "p1", metric: "discard_rate", condition: "lt", threshold: 0.02 }),
      ]);

      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.pipelineMetric.groupBy.mockResolvedValue([
        {
          pipelineId: "p1",
          _sum: { eventsIn: BigInt(10000), errorsTotal: BigInt(0), eventsDiscarded: BigInt(100) },
          _count: 50,
        },
      ]);

      const result = await batchEvaluatePipelineHealth(["p1"]);

      expect(result.p1.status).toBe("healthy");
      expect(result.p1.slis[0]).toMatchObject({
        metric: "discard_rate",
        status: "met",
        value: 0.01, // 100/10000
      });
    });

    it("returns no_data for discard_rate when zero events", async () => {
      prismaMock.pipelineSli.findMany.mockResolvedValue([
        makeSli({ pipelineId: "p1", metric: "discard_rate" }),
      ]);

      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.pipelineMetric.groupBy.mockResolvedValue([
        {
          pipelineId: "p1",
          _sum: { eventsIn: BigInt(0), errorsTotal: BigInt(0), eventsDiscarded: BigInt(0) },
          _count: 5,
        },
      ]);

      const result = await batchEvaluatePipelineHealth(["p1"]);

      expect(result.p1.slis[0]).toMatchObject({
        metric: "discard_rate",
        status: "no_data",
        value: null,
      });
    });
  });

  describe("throughput_floor SLI", () => {
    it("evaluates throughput correctly with gt condition", async () => {
      prismaMock.pipelineSli.findMany.mockResolvedValue([
        makeSli({
          pipelineId: "p1",
          metric: "throughput_floor",
          condition: "gt",
          threshold: 10,
          windowMinutes: 5,
        }),
      ]);

      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.pipelineMetric.groupBy.mockResolvedValue([
        {
          pipelineId: "p1",
          _sum: { eventsIn: BigInt(6000), errorsTotal: BigInt(0), eventsDiscarded: BigInt(0) },
          _count: 50,
        },
      ]);

      const result = await batchEvaluatePipelineHealth(["p1"]);

      // 6000 events / 300 seconds = 20 events/sec > 10 threshold (gt condition) → met
      expect(result.p1.status).toBe("healthy");
      expect(result.p1.slis[0]).toMatchObject({
        metric: "throughput_floor",
        status: "met",
        value: 20,
      });
    });

    it("evaluates breached when throughput below floor", async () => {
      prismaMock.pipelineSli.findMany.mockResolvedValue([
        makeSli({
          pipelineId: "p1",
          metric: "throughput_floor",
          condition: "gt",
          threshold: 100,
          windowMinutes: 5,
        }),
      ]);

      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.pipelineMetric.groupBy.mockResolvedValue([
        {
          pipelineId: "p1",
          _sum: { eventsIn: BigInt(6000), errorsTotal: BigInt(0), eventsDiscarded: BigInt(0) },
          _count: 50,
        },
      ]);

      const result = await batchEvaluatePipelineHealth(["p1"]);

      // 6000/300 = 20 events/sec, not > 100 → breached
      expect(result.p1.status).toBe("degraded");
      expect(result.p1.slis[0]).toMatchObject({
        metric: "throughput_floor",
        status: "breached",
        value: 20,
      });
    });
  });

  describe("latency_mean SLI", () => {
    it("evaluates latency correctly and triggers separate groupBy", async () => {
      prismaMock.pipelineSli.findMany.mockResolvedValue([
        makeSli({ pipelineId: "p1", metric: "latency_mean", condition: "lt", threshold: 100 }),
      ]);

      // First groupBy: sum aggregates
      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.pipelineMetric.groupBy.mockResolvedValueOnce([
        {
          pipelineId: "p1",
          _sum: { eventsIn: BigInt(1000), errorsTotal: BigInt(0), eventsDiscarded: BigInt(0) },
          _count: 50,
        },
      ]);

      // Second groupBy: latency avg
      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.pipelineMetric.groupBy.mockResolvedValueOnce([
        {
          pipelineId: "p1",
          _avg: { latencyMeanMs: 45.5 },
          _count: 30,
        },
      ]);

      const result = await batchEvaluatePipelineHealth(["p1"]);

      expect(result.p1.status).toBe("healthy");
      expect(result.p1.slis[0]).toMatchObject({
        metric: "latency_mean",
        status: "met",
        value: 45.5,
        threshold: 100,
      });

      // Should have made 2 groupBy calls: sum + latency
      expect(prismaMock.pipelineMetric.groupBy).toHaveBeenCalledTimes(2);
    });

    it("returns no_data when no latency metrics exist", async () => {
      prismaMock.pipelineSli.findMany.mockResolvedValue([
        makeSli({ pipelineId: "p1", metric: "latency_mean", condition: "lt", threshold: 100 }),
      ]);

      // First groupBy: sum aggregates (pipeline has data)
      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.pipelineMetric.groupBy.mockResolvedValueOnce([
        {
          pipelineId: "p1",
          _sum: { eventsIn: BigInt(1000), errorsTotal: BigInt(0), eventsDiscarded: BigInt(0) },
          _count: 50,
        },
      ]);

      // Second groupBy: latency — empty (no latency data)
      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.pipelineMetric.groupBy.mockResolvedValueOnce([]);

      const result = await batchEvaluatePipelineHealth(["p1"]);

      expect(result.p1.status).toBe("no_data");
      expect(result.p1.slis[0]).toMatchObject({
        metric: "latency_mean",
        status: "no_data",
        value: null,
      });
    });

    it("skips latency groupBy when no SLI uses latency_mean", async () => {
      prismaMock.pipelineSli.findMany.mockResolvedValue([
        makeSli({ pipelineId: "p1", metric: "error_rate" }),
      ]);

      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.pipelineMetric.groupBy.mockResolvedValue([
        {
          pipelineId: "p1",
          _sum: { eventsIn: BigInt(10000), errorsTotal: BigInt(100), eventsDiscarded: BigInt(0) },
          _count: 50,
        },
      ]);

      await batchEvaluatePipelineHealth(["p1"]);

      // Only 1 groupBy call (no latency query needed)
      expect(prismaMock.pipelineMetric.groupBy).toHaveBeenCalledTimes(1);
    });
  });

  describe("empty pipelines (no metric data)", () => {
    it("returns breached for all SLIs when pipeline has no metrics", async () => {
      prismaMock.pipelineSli.findMany.mockResolvedValue([
        makeSli({ pipelineId: "p1", metric: "error_rate" }),
        makeSli({ pipelineId: "p1", metric: "throughput_floor", condition: "gt", threshold: 10 }),
      ]);

      // No metrics for p1 — groupBy returns empty
      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.pipelineMetric.groupBy.mockResolvedValue([]);

      const result = await batchEvaluatePipelineHealth(["p1"]);

      expect(result.p1.status).toBe("degraded");
      expect(result.p1.slis).toHaveLength(2);
      expect(result.p1.slis[0]).toMatchObject({ metric: "error_rate", status: "breached", value: 0 });
      expect(result.p1.slis[1]).toMatchObject({ metric: "throughput_floor", status: "breached", value: 0 });
    });
  });

  describe("mixed windows", () => {
    it("uses the max window across all SLIs", async () => {
      prismaMock.pipelineSli.findMany.mockResolvedValue([
        makeSli({ pipelineId: "p1", metric: "error_rate", windowMinutes: 5 }),
        makeSli({ pipelineId: "p2", metric: "throughput_floor", condition: "gt", threshold: 10, windowMinutes: 15 }),
      ]);

      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.pipelineMetric.groupBy.mockResolvedValue([
        {
          pipelineId: "p1",
          _sum: { eventsIn: BigInt(10000), errorsTotal: BigInt(100), eventsDiscarded: BigInt(0) },
          _count: 50,
        },
        {
          pipelineId: "p2",
          _sum: { eventsIn: BigInt(90000), errorsTotal: BigInt(0), eventsDiscarded: BigInt(0) },
          _count: 150,
        },
      ]);

      await batchEvaluatePipelineHealth(["p1", "p2"]);

      // Verify the groupBy was called with the max window (15 minutes)
      expect(prismaMock.pipelineMetric.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            timestamp: expect.objectContaining({
              gte: expect.any(Date),
            }),
          }),
        }),
      );

      // The since date should be ~15 minutes ago (max window)
      const groupByMock = prismaMock.pipelineMetric.groupBy as unknown as ReturnType<typeof vi.fn>;
      const call = groupByMock.mock.calls[0][0] as {
        where: { timestamp: { gte: Date } };
      };
      const sinceMs = Date.now() - call.where.timestamp.gte.getTime();
      // Should be ~15 minutes (900000ms), allow 1s tolerance
      expect(sinceMs).toBeGreaterThan(899_000);
      expect(sinceMs).toBeLessThan(901_000);
    });
  });

  describe("overall status derivation", () => {
    it("returns healthy when all SLIs are met", async () => {
      prismaMock.pipelineSli.findMany.mockResolvedValue([
        makeSli({ pipelineId: "p1", metric: "error_rate", condition: "lt", threshold: 0.05 }),
        makeSli({ pipelineId: "p1", metric: "throughput_floor", condition: "gt", threshold: 10, windowMinutes: 5 }),
      ]);

      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.pipelineMetric.groupBy.mockResolvedValue([
        {
          pipelineId: "p1",
          _sum: { eventsIn: BigInt(10000), errorsTotal: BigInt(100), eventsDiscarded: BigInt(0) },
          _count: 50,
        },
      ]);

      const result = await batchEvaluatePipelineHealth(["p1"]);

      // error_rate: 100/10000 = 0.01 < 0.05 → met
      // throughput_floor: 10000/300 = 33.3 > 10 → met
      expect(result.p1.status).toBe("healthy");
    });

    it("returns degraded when any SLI is breached", async () => {
      prismaMock.pipelineSli.findMany.mockResolvedValue([
        makeSli({ pipelineId: "p1", metric: "error_rate", condition: "lt", threshold: 0.005 }),
        makeSli({ pipelineId: "p1", metric: "throughput_floor", condition: "gt", threshold: 10, windowMinutes: 5 }),
      ]);

      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.pipelineMetric.groupBy.mockResolvedValue([
        {
          pipelineId: "p1",
          _sum: { eventsIn: BigInt(10000), errorsTotal: BigInt(100), eventsDiscarded: BigInt(0) },
          _count: 50,
        },
      ]);

      const result = await batchEvaluatePipelineHealth(["p1"]);

      // error_rate: 100/10000 = 0.01, not < 0.005 → breached
      // throughput_floor: 10000/300 = 33.3 > 10 → met
      expect(result.p1.status).toBe("degraded");
    });

    it("returns no_data when all evaluated SLIs are no_data", async () => {
      prismaMock.pipelineSli.findMany.mockResolvedValue([
        makeSli({ pipelineId: "p1", metric: "error_rate" }),
        makeSli({ pipelineId: "p1", metric: "discard_rate" }),
      ]);

      // Both rate metrics but zero events → no_data for both
      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.pipelineMetric.groupBy.mockResolvedValue([
        {
          pipelineId: "p1",
          _sum: { eventsIn: BigInt(0), errorsTotal: BigInt(0), eventsDiscarded: BigInt(0) },
          _count: 5,
        },
      ]);

      const result = await batchEvaluatePipelineHealth(["p1"]);

      expect(result.p1.status).toBe("no_data");
    });
  });

  describe("multi-pipeline batch", () => {
    it("evaluates multiple pipelines with different SLIs correctly", async () => {
      prismaMock.pipelineSli.findMany.mockResolvedValue([
        makeSli({ pipelineId: "p1", metric: "error_rate", condition: "lt", threshold: 0.05 }),
        makeSli({ pipelineId: "p2", metric: "throughput_floor", condition: "gt", threshold: 10, windowMinutes: 5 }),
        makeSli({ pipelineId: "p3", metric: "error_rate", condition: "lt", threshold: 0.01 }),
      ]);

      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.pipelineMetric.groupBy.mockResolvedValue([
        {
          pipelineId: "p1",
          _sum: { eventsIn: BigInt(10000), errorsTotal: BigInt(100), eventsDiscarded: BigInt(0) },
          _count: 50,
        },
        {
          pipelineId: "p2",
          _sum: { eventsIn: BigInt(90000), errorsTotal: BigInt(0), eventsDiscarded: BigInt(0) },
          _count: 150,
        },
        {
          pipelineId: "p3",
          _sum: { eventsIn: BigInt(10000), errorsTotal: BigInt(500), eventsDiscarded: BigInt(0) },
          _count: 50,
        },
      ]);

      // Also request p4 which has no SLIs
      const result = await batchEvaluatePipelineHealth(["p1", "p2", "p3", "p4"]);

      // p1: error_rate 100/10000=0.01 < 0.05 → met → healthy
      expect(result.p1.status).toBe("healthy");

      // p2: throughput 90000/300=300 > 10 → met → healthy
      expect(result.p2.status).toBe("healthy");

      // p3: error_rate 500/10000=0.05, not < 0.01 → breached → degraded
      expect(result.p3.status).toBe("degraded");

      // p4: no SLIs → no_data
      expect(result.p4.status).toBe("no_data");

      // Only 1 findMany call for all SLIs
      expect(prismaMock.pipelineSli.findMany).toHaveBeenCalledTimes(1);
    });
  });
});
