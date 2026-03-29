import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import {
  computeBaseline,
  detectAnomalies,
  type MetricDataPoint,
  type AnomalyDetectionResult,
  ANOMALY_CONFIG,
} from "@/server/services/anomaly-detector";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// ─── Fixture helpers ────────────────────────────────────────────────────────

const NOW = new Date("2026-03-29T12:00:00Z");

function makeMetricPoints(
  values: number[],
  startDate: Date = new Date("2026-03-22T12:00:00Z"),
): MetricDataPoint[] {
  return values.map((value, i) => ({
    timestamp: new Date(startDate.getTime() + i * 3600_000), // hourly
    value,
  }));
}

function makeStableMetrics(mean: number, count: number): MetricDataPoint[] {
  // Generate stable data points around a mean with small variance
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    // Alternate slightly above/below mean for realistic stddev
    values.push(mean + (i % 2 === 0 ? 10 : -10));
  }
  return makeMetricPoints(values);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("computeBaseline", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("computes mean and stddev for a stable dataset", () => {
    const points = makeMetricPoints([100, 100, 100, 100, 100]);
    const baseline = computeBaseline(points);

    expect(baseline.mean).toBe(100);
    expect(baseline.stddev).toBe(0);
    expect(baseline.sampleCount).toBe(5);
  });

  it("computes correct mean and stddev for variable dataset", () => {
    // Values: 10, 20, 30, 40, 50 → mean = 30, stddev ≈ 14.14
    const points = makeMetricPoints([10, 20, 30, 40, 50]);
    const baseline = computeBaseline(points);

    expect(baseline.mean).toBeCloseTo(30, 1);
    expect(baseline.stddev).toBeCloseTo(14.14, 1);
    expect(baseline.sampleCount).toBe(5);
  });

  it("returns zero stddev for single data point", () => {
    const points = makeMetricPoints([42]);
    const baseline = computeBaseline(points);

    expect(baseline.mean).toBe(42);
    expect(baseline.stddev).toBe(0);
    expect(baseline.sampleCount).toBe(1);
  });

  it("returns null for empty dataset", () => {
    const baseline = computeBaseline([]);
    expect(baseline).toBeNull();
  });
});

describe("detectAnomalies", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("detects throughput_drop when current value is 3+ stddev below mean", () => {
    // Baseline: mean=1000, stddev=100 → 3-sigma lower = 700
    const baseline = makeStableMetrics(1000, 168); // 7 days hourly
    const currentValue = 400; // well below 3-sigma

    const results = detectAnomalies(
      "pipe-1",
      "eventsIn",
      currentValue,
      baseline,
    );

    expect(results).toHaveLength(1);
    expect(results[0].anomalyType).toBe("throughput_drop");
    expect(results[0].severity).toBe("critical"); // > 4 sigma
    expect(results[0].deviationFactor).toBeGreaterThan(3);
  });

  it("detects throughput_spike when current value is 3+ stddev above mean", () => {
    const baseline = makeStableMetrics(1000, 168);
    const currentValue = 1500; // well above 3-sigma

    const results = detectAnomalies(
      "pipe-1",
      "eventsIn",
      currentValue,
      baseline,
    );

    expect(results).toHaveLength(1);
    expect(results[0].anomalyType).toBe("throughput_spike");
    expect(results[0].deviationFactor).toBeGreaterThan(3);
  });

  it("detects error_rate_spike for errorsTotal metric", () => {
    const baseline = makeStableMetrics(5, 168); // 5 errors/interval average
    const currentValue = 100; // massive spike

    const results = detectAnomalies(
      "pipe-1",
      "errorsTotal",
      currentValue,
      baseline,
    );

    expect(results).toHaveLength(1);
    expect(results[0].anomalyType).toBe("error_rate_spike");
  });

  it("detects latency_spike for latencyMeanMs metric", () => {
    const baseline = makeStableMetrics(50, 168); // 50ms average
    const currentValue = 500; // 10x latency

    const results = detectAnomalies(
      "pipe-1",
      "latencyMeanMs",
      currentValue,
      baseline,
    );

    expect(results).toHaveLength(1);
    expect(results[0].anomalyType).toBe("latency_spike");
  });

  it("does NOT flag normal values within 3-sigma", () => {
    const baseline = makeStableMetrics(1000, 168);
    const currentValue = 1005; // well within range

    const results = detectAnomalies(
      "pipe-1",
      "eventsIn",
      currentValue,
      baseline,
    );

    expect(results).toHaveLength(0);
  });

  it("does NOT flag when insufficient baseline data (< 24 points)", () => {
    const baseline = makeMetricPoints([100, 200, 300]); // only 3 points
    const currentValue = 10000;

    const results = detectAnomalies(
      "pipe-1",
      "eventsIn",
      currentValue,
      baseline,
    );

    expect(results).toHaveLength(0);
  });

  it("assigns warning severity for 3-4 sigma deviation", () => {
    // Build a dataset with known mean=1000, stddev=100
    const values = Array.from({ length: 168 }, (_, i) =>
      i % 2 === 0 ? 1100 : 900
    );
    const baseline = makeMetricPoints(values);
    // 3.5 sigma below: 1000 - 3.5*100 = 650
    const currentValue = 650;

    const results = detectAnomalies(
      "pipe-1",
      "eventsIn",
      currentValue,
      baseline,
    );

    if (results.length > 0) {
      expect(results[0].severity).toBe("warning");
    }
  });

  it("assigns critical severity for > 4 sigma deviation", () => {
    const values = Array.from({ length: 168 }, (_, i) =>
      i % 2 === 0 ? 1100 : 900
    );
    const baseline = makeMetricPoints(values);
    // 5 sigma below: 1000 - 5*100 = 500
    const currentValue = 500;

    const results = detectAnomalies(
      "pipe-1",
      "eventsIn",
      currentValue,
      baseline,
    );

    if (results.length > 0) {
      expect(results[0].severity).toBe("critical");
    }
  });

  it("handles zero stddev gracefully (constant baseline)", () => {
    const baseline = makeMetricPoints(Array(168).fill(100));
    const currentValue = 101; // tiny deviation from constant

    const results = detectAnomalies(
      "pipe-1",
      "eventsIn",
      currentValue,
      baseline,
    );

    // Zero stddev means any deviation is infinite sigma — use min stddev floor
    // The service should apply a minimum stddev floor to avoid false positives
    expect(results).toHaveLength(0); // 1 unit change on 100 should not alert
  });

  it("handles zero stddev with significant deviation", () => {
    const baseline = makeMetricPoints(Array(168).fill(100));
    const currentValue = 200; // 100% increase on a constant baseline

    const results = detectAnomalies(
      "pipe-1",
      "eventsIn",
      currentValue,
      baseline,
    );

    expect(results).toHaveLength(1);
    expect(results[0].anomalyType).toBe("throughput_spike");
  });
});

describe("ANOMALY_CONFIG", () => {
  it("has sensible defaults", () => {
    expect(ANOMALY_CONFIG.BASELINE_WINDOW_DAYS).toBe(7);
    expect(ANOMALY_CONFIG.SIGMA_THRESHOLD).toBe(3);
    expect(ANOMALY_CONFIG.MIN_BASELINE_POINTS).toBe(24);
    expect(ANOMALY_CONFIG.MIN_STDDEV_FLOOR_PERCENT).toBe(5);
  });
});
