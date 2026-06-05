import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => {
  const __pm = mockDeep<PrismaClient>();
  return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
});
vi.mock("@/lib/logger", () => ({ debugLog: vi.fn(), infoLog: vi.fn(), errorLog: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { detectTraceTailSample } from "@/server/services/cost-optimizer";
import type { PipelineAggregates, SuggestedAction } from "@/server/services/cost-optimizer-types";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
});

/** N single-span traces with unique trace ids, fast and error-free — a strong
 *  tail-sampling candidate (only the probabilistic baseline survives). */
function fastTraceSpans(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    trace_id: `trace-${i}`,
    duration_ms: 5,
    service: "api",
  }));
}

/** High-volume, low-error trace pipeline aggregate. */
function makeTraceAgg(overrides: Partial<PipelineAggregates> = {}): PipelineAggregates {
  return {
    pipelineId: "pipe-trace",
    pipelineName: "trace-pipeline",
    environmentId: "env-1",
    teamId: "team-1",
    totalBytesIn: BigInt(4_000_000_000), // 4 GB
    totalBytesOut: BigInt(4_000_000_000),
    totalEventsIn: BigInt(5_000_000),
    totalEventsOut: BigInt(5_000_000),
    totalErrors: BigInt(0),
    totalDiscarded: BigInt(0),
    totalSpansIn: BigInt(5_000_000),
    totalSpansOut: BigInt(5_000_000),
    totalTracesIn: BigInt(1_000_000),
    metricCount: 100,
    ...overrides,
  };
}

describe("detectTraceTailSample", () => {
  it("fires on a high-volume low-error trace pipeline with a simulated reduction", async () => {
    prismaMock.tapCapture.findFirst.mockResolvedValue({
      events: fastTraceSpans(200),
    } as never);

    const results = await detectTraceTailSample([makeTraceAgg()]);

    expect(results).toHaveLength(1);
    const rec = results[0];
    expect(rec.type).toBe("TRACE_TAIL_SAMPLE");
    expect(rec.pipelineId).toBe("pipe-trace");

    // suggestedAction is a tail_sample transform config keyed by trace_id.
    const action = rec.suggestedAction as SuggestedAction;
    expect(action.type).toBe("tail_sample");
    if (action.type === "tail_sample") {
      expect(action.config.key).toBe("trace_id");
      expect(action.config.windowMs).toBeGreaterThan(0);
      expect(action.config.keepPolicies.onError).toBe(true);
      expect(action.config.keepPolicies.baselinePercent).toBeGreaterThan(0);
      expect(action.config.componentKey).toContain("tail_sample_");
    }

    // Projected reduction is real (from the A6 simulator) and meaningful.
    const data = rec.analysisData as {
      projectionBasis: string;
      projectedReductionPercent: number;
      totalTraces?: number;
      keptTraces?: number;
    };
    expect(data.projectionBasis).toBe("simulated");
    expect(data.projectedReductionPercent).toBeGreaterThanOrEqual(20);
    expect(data.projectedReductionPercent).toBeLessThanOrEqual(100);
    expect(data.totalTraces).toBe(200);
    expect(data.keptTraces).toBeLessThan(200); // most traces dropped
    expect(Number(rec.estimatedSavingsBytes)).toBeGreaterThan(0);
  });

  it("falls back to a conservative estimate when no trace events are captured", async () => {
    prismaMock.tapCapture.findFirst.mockResolvedValue(null as never);
    prismaMock.eventSample.findFirst.mockResolvedValue(null as never);

    const results = await detectTraceTailSample([makeTraceAgg()]);

    expect(results).toHaveLength(1);
    const data = results[0].analysisData as {
      projectionBasis: string;
      projectedReductionPercent: number;
    };
    expect(data.projectionBasis).toBe("estimated");
    // No errors + 10% baseline ⇒ ~90% projected drop.
    expect(data.projectedReductionPercent).toBeGreaterThanOrEqual(20);
    expect((results[0].suggestedAction as SuggestedAction).type).toBe("tail_sample");
  });

  it("does NOT fire on a log-only pipeline (no trace volume)", async () => {
    const results = await detectTraceTailSample([
      makeTraceAgg({ totalSpansIn: BigInt(0), totalSpansOut: BigInt(0), totalTracesIn: BigInt(0) }),
    ]);

    expect(results).toHaveLength(0);
    // Skips before querying for any events.
    expect(prismaMock.tapCapture.findFirst).not.toHaveBeenCalled();
  });

  it("does NOT fire on a high-error trace pipeline", async () => {
    // 20% of spans errored — tail sampling keeps almost everything, saving little.
    const results = await detectTraceTailSample([
      makeTraceAgg({ totalErrors: BigInt(1_000_000) }),
    ]);

    expect(results).toHaveLength(0);
    expect(prismaMock.tapCapture.findFirst).not.toHaveBeenCalled();
  });

  it("does NOT fire below the minimum span-volume threshold", async () => {
    const results = await detectTraceTailSample([
      makeTraceAgg({ totalSpansIn: BigInt(100_000), totalTracesIn: BigInt(20_000) }),
    ]);

    expect(results).toHaveLength(0);
    expect(prismaMock.tapCapture.findFirst).not.toHaveBeenCalled();
  });
});
