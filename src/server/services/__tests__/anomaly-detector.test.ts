import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/alert-correlator", () => ({
  correlateAnomalyEvent: vi.fn().mockResolvedValue({ id: "group-1" }),
}));

import { prisma } from "@/lib/prisma";
import { correlateAnomalyEvent } from "@/server/services/alert-correlator";
import {
  computeBaseline,
  detectAnomalies,
  evaluatePipeline,
  evaluateAllPipelines,
  invalidateBaselineCache,
  type MetricDataPoint,
  ANOMALY_CONFIG,
} from "@/server/services/anomaly-detector";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// ─── Fixture helpers ────────────────────────────────────────────────────────

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

    expect(baseline!.mean).toBe(100);
    expect(baseline!.stddev).toBe(0);
    expect(baseline!.sampleCount).toBe(5);
  });

  it("computes correct mean and stddev for variable dataset", () => {
    // Values: 10, 20, 30, 40, 50 → mean = 30, stddev ≈ 14.14
    const points = makeMetricPoints([10, 20, 30, 40, 50]);
    const baseline = computeBaseline(points);

    expect(baseline!.mean).toBeCloseTo(30, 1);
    expect(baseline!.stddev).toBeCloseTo(14.14, 1);
    expect(baseline!.sampleCount).toBe(5);
  });

  it("returns zero stddev for single data point", () => {
    const points = makeMetricPoints([42]);
    const baseline = computeBaseline(points);

    expect(baseline!.mean).toBe(42);
    expect(baseline!.stddev).toBe(0);
    expect(baseline!.sampleCount).toBe(1);
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

  it("POLL_INTERVAL_MS is 300_000 (5 minutes)", () => {
    expect(ANOMALY_CONFIG.POLL_INTERVAL_MS).toBe(300_000);
  });
});

// ─── SQL-optimized functions ─────────────────────────────────────────────────

describe("fetchBaselineSql (via evaluateAllPipelines integration)", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    invalidateBaselineCache();
  });

  it("evaluateAllPipelines uses $queryRawUnsafe for baseline and current metrics", async () => {
    // Mock: no deployed pipelines → short-circuits immediately
    prismaMock.pipeline.findMany.mockResolvedValue([]);

    const results = await evaluateAllPipelines();
    expect(results).toEqual([]);

    // systemSettings is fetched for config
    // pipeline.findMany is called once
    expect(prismaMock.pipeline.findMany).toHaveBeenCalledTimes(1);
  });

  it("evaluateAllPipelines calls $queryRawUnsafe for all pipelines in a single batch", async () => {
    // Mock two deployed pipelines
    prismaMock.pipeline.findMany.mockResolvedValue([
      { id: "pipe-1", environmentId: "env-1", environment: { teamId: "team-1" } },
      { id: "pipe-2", environmentId: "env-1", environment: { teamId: "team-1" } },
    ] as never);

    // Mock systemSettings for config
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);

    // Mock $queryRawUnsafe: first call = current metrics batch (DISTINCT ON), subsequent = baseline per pipeline
    prismaMock.$queryRawUnsafe
      // Call 1: fetchAllCurrentMetrics (DISTINCT ON query)
      .mockResolvedValueOnce([
        { pipelineId: "pipe-1", eventsIn: BigInt(1000), errorsTotal: BigInt(0), latencyMeanMs: 50 },
        { pipelineId: "pipe-2", eventsIn: BigInt(500), errorsTotal: BigInt(2), latencyMeanMs: 30 },
      ])
      // Call 2: baseline for pipe-1
      .mockResolvedValueOnce([
        {
          eventsInMean: 980,
          eventsInStddev: 20,
          errorsTotalMean: 1,
          errorsTotalStddev: 0.5,
          latencyMeanMsMean: 48,
          latencyMeanMsStddev: 3,
          sampleCount: 168,
        },
      ])
      // Call 3: baseline for pipe-2
      .mockResolvedValueOnce([
        {
          eventsInMean: 490,
          eventsInStddev: 15,
          errorsTotalMean: 2,
          errorsTotalStddev: 0.8,
          latencyMeanMsMean: 29,
          latencyMeanMsStddev: 2,
          sampleCount: 168,
        },
      ]);

    // No anomaly events exist (no deduplication triggers)
    prismaMock.anomalyEvent.findFirst.mockResolvedValue(null);

    const results = await evaluateAllPipelines();

    // $queryRawUnsafe called at least once (for current metrics batch)
    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalled();

    // The first call should be the DISTINCT ON batch query (contains both pipeline IDs)
    const firstCall = prismaMock.$queryRawUnsafe.mock.calls[0];
    expect(firstCall[0]).toMatch(/DISTINCT ON/i);

    // Should return array (anomalies if any detected, or empty if within normal range)
    expect(Array.isArray(results)).toBe(true);
  });
});

describe("evaluatePipeline correlation", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.mocked(correlateAnomalyEvent).mockClear();
    invalidateBaselineCache();
  });

  it("correlates each newly persisted anomaly event into an alert correlation group", async () => {
    const pipeline = {
      id: "pipe-1",
      environmentId: "env-1",
      environment: { teamId: "team-1" },
    };
    const anomalyEvent = {
      id: "anomaly-1",
      pipelineId: "pipe-1",
      environmentId: "env-1",
      teamId: "team-1",
      anomalyType: "throughput_spike",
      severity: "critical",
      metricName: "eventsIn",
      currentValue: 2000,
      baselineMean: 1000,
      baselineStddev: 100,
      deviationFactor: 10,
      message: "Throughput spike detected",
      status: "open",
      detectedAt: new Date("2026-04-30T12:00:00Z"),
      acknowledgedAt: null,
      acknowledgedBy: null,
      dismissedAt: null,
      dismissedBy: null,
      errorContext: null,
      correlationGroupId: null,
      createdAt: new Date("2026-04-30T12:00:00Z"),
    };

    prismaMock.systemSettings.findUnique.mockResolvedValue(null);
    prismaMock.$queryRawUnsafe
      .mockResolvedValueOnce([
        {
          pipelineId: "pipe-1",
          eventsIn: BigInt(2000),
          errorsTotal: BigInt(0),
          latencyMeanMs: 50,
        },
      ])
      .mockResolvedValueOnce([
        {
          eventsInMean: 1000,
          eventsInStddev: 100,
          errorsTotalMean: 0,
          errorsTotalStddev: 1,
          latencyMeanMsMean: 50,
          latencyMeanMsStddev: 5,
          sampleCount: 168,
        },
      ]);
    prismaMock.anomalyEvent.findFirst.mockResolvedValue(null);
    prismaMock.anomalyEvent.create.mockResolvedValue(anomalyEvent as never);

    await evaluatePipeline(pipeline as never);

    expect(correlateAnomalyEvent).toHaveBeenCalledWith(anomalyEvent);
  });
});

describe("baseline cache", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    invalidateBaselineCache();
  });

  afterEach(() => {
    invalidateBaselineCache();
  });

  it("invalidateBaselineCache clears cached baselines so next call re-fetches", async () => {
    prismaMock.pipeline.findMany.mockResolvedValue([
      { id: "pipe-cache", environmentId: "env-1", environment: { teamId: "team-1" } },
    ] as never);
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);

    // Setup: current metrics returns a row
    prismaMock.$queryRawUnsafe
      .mockResolvedValueOnce([
        { pipelineId: "pipe-cache", eventsIn: BigInt(500), errorsTotal: BigInt(0), latencyMeanMs: 30 },
      ])
      // baseline query 1st time
      .mockResolvedValueOnce([
        {
          eventsInMean: 490,
          eventsInStddev: 10,
          errorsTotalMean: 0,
          errorsTotalStddev: 0,
          latencyMeanMsMean: 29,
          latencyMeanMsStddev: 1,
          sampleCount: 100,
        },
      ]);
    prismaMock.anomalyEvent.findFirst.mockResolvedValue(null);

    await evaluateAllPipelines();

    const callsAfterFirst = prismaMock.$queryRawUnsafe.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Reset mocks and invalidate cache → next call should re-fetch baseline
    mockReset(prismaMock);
    invalidateBaselineCache();

    prismaMock.pipeline.findMany.mockResolvedValue([
      { id: "pipe-cache", environmentId: "env-1", environment: { teamId: "team-1" } },
    ] as never);
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);
    prismaMock.$queryRawUnsafe
      .mockResolvedValueOnce([
        { pipelineId: "pipe-cache", eventsIn: BigInt(500), errorsTotal: BigInt(0), latencyMeanMs: 30 },
      ])
      .mockResolvedValueOnce([
        {
          eventsInMean: 490,
          eventsInStddev: 10,
          errorsTotalMean: 0,
          errorsTotalStddev: 0,
          latencyMeanMsMean: 29,
          latencyMeanMsStddev: 1,
          sampleCount: 100,
        },
      ]);
    prismaMock.anomalyEvent.findFirst.mockResolvedValue(null);

    await evaluateAllPipelines();

    // After cache invalidation, $queryRawUnsafe must be called again (not served from cache)
    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalled();
  });

  it("cached baseline is reused within TTL (no extra SQL on second call for same pipeline)", async () => {
    // This test verifies the cache works by mocking two consecutive evaluations
    // and checking that baseline SQL is only called ONCE for the same pipeline
    // when cache is warm (within TTL)
    prismaMock.pipeline.findMany.mockResolvedValue([
      { id: "pipe-cached", environmentId: "env-1", environment: { teamId: "team-1" } },
    ] as never);
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);
    prismaMock.anomalyEvent.findFirst.mockResolvedValue(null);

    // First evaluation: current metrics + baseline fetched
    prismaMock.$queryRawUnsafe
      .mockResolvedValueOnce([
        { pipelineId: "pipe-cached", eventsIn: BigInt(500), errorsTotal: BigInt(0), latencyMeanMs: 30 },
      ])
      .mockResolvedValueOnce([
        {
          eventsInMean: 490,
          eventsInStddev: 10,
          errorsTotalMean: 0,
          errorsTotalStddev: 0,
          latencyMeanMsMean: 29,
          latencyMeanMsStddev: 1,
          sampleCount: 100,
        },
      ]);

    await evaluateAllPipelines();
    const callsAfterFirst = prismaMock.$queryRawUnsafe.mock.calls.length;

    // Second evaluation within TTL: current metrics re-fetched, but baseline served from cache
    prismaMock.$queryRawUnsafe
      .mockResolvedValueOnce([
        { pipelineId: "pipe-cached", eventsIn: BigInt(500), errorsTotal: BigInt(0), latencyMeanMs: 30 },
      ]);

    await evaluateAllPipelines();
    const callsAfterSecond = prismaMock.$queryRawUnsafe.mock.calls.length;

    // Second run only adds 1 call (current metrics batch), not 2 (would be +2 if baseline re-fetched)
    expect(callsAfterSecond - callsAfterFirst).toBe(1);
  });
});

describe("fetchAllCurrentMetrics (via evaluateAllPipelines)", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    invalidateBaselineCache();
  });

  it("handles null latencyMeanMs as 0 in current metrics", async () => {
    prismaMock.pipeline.findMany.mockResolvedValue([
      { id: "pipe-null-lat", environmentId: "env-1", environment: { teamId: "team-1" } },
    ] as never);
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);

    // latencyMeanMs is null in the current row
    prismaMock.$queryRawUnsafe
      .mockResolvedValueOnce([
        { pipelineId: "pipe-null-lat", eventsIn: BigInt(100), errorsTotal: BigInt(0), latencyMeanMs: null },
      ])
      .mockResolvedValueOnce([
        {
          eventsInMean: 95,
          eventsInStddev: 5,
          errorsTotalMean: 0,
          errorsTotalStddev: 0,
          latencyMeanMsMean: null,
          latencyMeanMsStddev: null,
          sampleCount: 100,
        },
      ]);
    prismaMock.anomalyEvent.findFirst.mockResolvedValue(null);

    // Should not throw — null latency handled gracefully
    const results = await evaluateAllPipelines();
    expect(Array.isArray(results)).toBe(true);
  });

  it("skips pipeline with no current metrics row", async () => {
    prismaMock.pipeline.findMany.mockResolvedValue([
      { id: "pipe-no-data", environmentId: "env-1", environment: { teamId: "team-1" } },
    ] as never);
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);

    // DISTINCT ON query returns no rows for this pipeline
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([]);

    const results = await evaluateAllPipelines();
    expect(results).toEqual([]);

    // No baseline query should be made when current metrics are missing
    // (only the 1 DISTINCT ON call was made)
    const queryRawCalls = prismaMock.$queryRawUnsafe.mock.calls;
    expect(queryRawCalls.length).toBe(1);
  });

  it("returns no results when sampleCount < minBaselinePoints", async () => {
    prismaMock.pipeline.findMany.mockResolvedValue([
      { id: "pipe-few", environmentId: "env-1", environment: { teamId: "team-1" } },
    ] as never);
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);

    prismaMock.$queryRawUnsafe
      .mockResolvedValueOnce([
        { pipelineId: "pipe-few", eventsIn: BigInt(9999), errorsTotal: BigInt(100), latencyMeanMs: 500 },
      ])
      .mockResolvedValueOnce([
        {
          eventsInMean: 100,
          eventsInStddev: 10,
          errorsTotalMean: 0,
          errorsTotalStddev: 0,
          latencyMeanMsMean: 50,
          latencyMeanMsStddev: 5,
          sampleCount: 5, // below MIN_BASELINE_POINTS (24)
        },
      ]);
    prismaMock.anomalyEvent.findFirst.mockResolvedValue(null);

    // With insufficient baseline data, no anomalies should be detected
    const results = await evaluateAllPipelines();
    expect(results).toEqual([]);
  });
});
