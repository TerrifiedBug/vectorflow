import { describe, it, expect, vi } from "vitest";
import type { PipelineAggregates } from "@/server/services/cost-optimizer-types";
import { DEFAULT_THRESHOLDS } from "@/server/services/cost-optimizer-types";

// Mock prisma to prevent env validation from running at import time
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  detectLowReduction,
  detectHighErrorRate,
} from "@/server/services/cost-optimizer";

function makeAgg(overrides: Partial<PipelineAggregates> = {}): PipelineAggregates {
  return {
    pipelineId: "pipe-1",
    pipelineName: "test-pipeline",
    environmentId: "env-1",
    teamId: "team-1",
    totalBytesIn: BigInt(10_000_000_000),  // 10 GB
    totalBytesOut: BigInt(10_000_000_000), // 10 GB (no reduction)
    totalEventsIn: BigInt(1_000_000),
    totalEventsOut: BigInt(1_000_000),
    totalErrors: BigInt(0),
    totalDiscarded: BigInt(0),
    metricCount: 100,
    ...overrides,
  };
}

describe("detectLowReduction", () => {
  it("flags pipeline with zero reduction and high volume", () => {
    const agg = makeAgg({
      totalBytesIn: BigInt(5_000_000_000),
      totalBytesOut: BigInt(5_000_000_000),
    });

    const results = detectLowReduction([agg]);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("LOW_REDUCTION");
    expect(results[0].pipelineId).toBe("pipe-1");
    expect(results[0].suggestedAction?.type).toBe("add_sampling");
  });

  it("does not flag pipeline with good reduction", () => {
    const agg = makeAgg({
      totalBytesIn: BigInt(10_000_000_000),
      totalBytesOut: BigInt(3_000_000_000), // 70% reduction
    });

    const results = detectLowReduction([agg]);
    expect(results).toHaveLength(0);
  });

  it("does not flag low-volume pipelines", () => {
    const agg = makeAgg({
      totalBytesIn: BigInt(500_000), // under 1 GB threshold
      totalBytesOut: BigInt(500_000),
    });

    const results = detectLowReduction([agg]);
    expect(results).toHaveLength(0);
  });

  it("respects custom thresholds", () => {
    const agg = makeAgg({
      totalBytesIn: BigInt(500_000_000), // 500 MB
      totalBytesOut: BigInt(500_000_000),
    });

    const customThresholds = {
      ...DEFAULT_THRESHOLDS,
      minBytesIn: BigInt(100_000_000), // lower threshold: 100 MB
    };

    const results = detectLowReduction([agg], customThresholds);
    expect(results).toHaveLength(1);
  });

  it("calculates estimated savings as 20% of bytes in", () => {
    const agg = makeAgg({
      totalBytesIn: BigInt(10_000_000_000),
      totalBytesOut: BigInt(10_000_000_000),
    });

    const results = detectLowReduction([agg]);
    expect(results[0].estimatedSavingsBytes).toBe(BigInt(2_000_000_000));
  });
});

describe("detectHighErrorRate", () => {
  it("flags pipeline with error rate above threshold", () => {
    const agg = makeAgg({
      totalEventsIn: BigInt(1000),
      totalErrors: BigInt(120),    // 12% error
      totalDiscarded: BigInt(0),
    });

    const results = detectHighErrorRate([agg]);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("HIGH_ERROR_RATE");
    expect(results[0].suggestedAction?.type).toBe("add_filter");
  });

  it("includes discarded events in error rate", () => {
    const agg = makeAgg({
      totalEventsIn: BigInt(1000),
      totalErrors: BigInt(50),
      totalDiscarded: BigInt(60), // combined 11%
    });

    const results = detectHighErrorRate([agg]);
    expect(results).toHaveLength(1);
  });

  it("does not flag pipeline with low error rate", () => {
    const agg = makeAgg({
      totalEventsIn: BigInt(1000),
      totalErrors: BigInt(5),      // 0.5% error
      totalDiscarded: BigInt(0),
    });

    const results = detectHighErrorRate([agg]);
    expect(results).toHaveLength(0);
  });

  it("skips pipelines with zero events", () => {
    const agg = makeAgg({
      totalEventsIn: BigInt(0),
      totalErrors: BigInt(0),
      totalDiscarded: BigInt(0),
    });

    const results = detectHighErrorRate([agg]);
    expect(results).toHaveLength(0);
  });

  it("estimates savings proportional to error rate", () => {
    const agg = makeAgg({
      totalBytesIn: BigInt(10_000_000_000),
      totalEventsIn: BigInt(1000),
      totalErrors: BigInt(200),    // 20% error
      totalDiscarded: BigInt(0),
    });

    const results = detectHighErrorRate([agg]);
    // 20% of 10 GB = 2 GB
    expect(results[0].estimatedSavingsBytes).toBe(BigInt(2_000_000_000));
  });
});
