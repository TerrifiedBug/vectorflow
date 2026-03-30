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
  evaluatePipeline,
  type MetricDataPoint,
} from "@/server/services/anomaly-detector";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// ─── Fixture generators ─────────────────────────────────────────────────────

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
const BASE_DATE = new Date("2026-03-22T00:00:00Z");

/**
 * Generate 7 days of hourly metric rows simulating a stable pipeline
 * with a diurnal throughput pattern (higher during business hours).
 */
function generateRealisticBaseline(): {
  timestamp: Date;
  eventsIn: bigint;
  errorsTotal: bigint;
  latencyMeanMs: number | null;
  componentId: string | null;
  pipelineId: string;
}[] {
  const rows = [];
  for (let h = 0; h < 168; h++) {
    // Stable throughput with small jitter (mean ~5000, stddev ~100)
    const baseEvents = 5000;
    const jitter = Math.sin(h * 0.1) * 100; // small smooth variance

    rows.push({
      timestamp: new Date(BASE_DATE.getTime() + h * HOUR_MS),
      eventsIn: BigInt(Math.round(baseEvents + jitter)),
      errorsTotal: BigInt(Math.round(10 + Math.sin(h * 0.1) * 3)),
      latencyMeanMs: 45 + Math.sin(h * 0.05) * 5,
      componentId: null,
      pipelineId: "pipe-1",
    });
  }
  return rows;
}

/**
 * Generate a current metric snapshot for a pipeline exhibiting
 * a specific anomaly type.
 */
function generateAnomalySnapshot(type: string) {
  switch (type) {
    case "throughput_drop":
      return {
        eventsIn: BigInt(50), // nearly zero vs baseline of ~3500
        errorsTotal: BigInt(8),
        latencyMeanMs: 47,
      };
    case "throughput_spike":
      return {
        eventsIn: BigInt(50000), // 10x normal
        errorsTotal: BigInt(10),
        latencyMeanMs: 50,
      };
    case "error_rate_spike":
      return {
        eventsIn: BigInt(3500),
        errorsTotal: BigInt(500), // 50x normal
        latencyMeanMs: 48,
      };
    case "latency_spike":
      return {
        eventsIn: BigInt(3500),
        errorsTotal: BigInt(8),
        latencyMeanMs: 500, // 10x normal
      };
    default:
      return {
        eventsIn: BigInt(3500),
        errorsTotal: BigInt(8),
        latencyMeanMs: 47,
      };
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Anomaly Detection Integration", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("detects throughput_drop on a pipeline with realistic data", async () => {
    const baselineRows = generateRealisticBaseline();
    const currentSnapshot = generateAnomalySnapshot("throughput_drop");

    // Mock: fetch latest metric
    prismaMock.pipelineMetric.findFirst.mockResolvedValue({
      ...currentSnapshot,
      id: "m-latest",
      pipelineId: "pipe-1",
      nodeId: null,
      componentId: null,
      timestamp: new Date("2026-03-29T12:00:00Z"),
      eventsDiscarded: BigInt(0),
      bytesIn: BigInt(0),
      bytesOut: BigInt(0),
      utilization: 0,
    } as never);

    // Mock: fetch baseline data
    prismaMock.pipelineMetric.findMany.mockResolvedValue(
      baselineRows as never,
    );

    // Mock: no existing anomaly (dedup check)
    prismaMock.anomalyEvent.findFirst.mockResolvedValue(null);

    // Mock: create anomaly
    prismaMock.anomalyEvent.create.mockResolvedValue({
      id: "anomaly-new",
      pipelineId: "pipe-1",
      anomalyType: "throughput_drop",
      severity: "critical",
      status: "open",
    } as never);

    const pipeline = {
      id: "pipe-1",
      environmentId: "env-1",
      environment: { teamId: "team-1" },
    };

    const results = await evaluatePipeline(pipeline);

    expect(results.length).toBeGreaterThanOrEqual(1);
    const throughputDrop = results.find(
      (r) => r.anomalyType === "throughput_drop",
    );
    expect(throughputDrop).toBeDefined();
    expect(throughputDrop!.severity).toBe("critical");
    expect(prismaMock.anomalyEvent.create).toHaveBeenCalled();
  });

  it("detects error_rate_spike on a pipeline with realistic data", async () => {
    const baselineRows = generateRealisticBaseline();
    const currentSnapshot = generateAnomalySnapshot("error_rate_spike");

    prismaMock.pipelineMetric.findFirst.mockResolvedValue({
      ...currentSnapshot,
      id: "m-latest",
      pipelineId: "pipe-1",
      nodeId: null,
      componentId: null,
      timestamp: new Date("2026-03-29T12:00:00Z"),
      eventsDiscarded: BigInt(0),
      bytesIn: BigInt(0),
      bytesOut: BigInt(0),
      utilization: 0,
    } as never);

    prismaMock.pipelineMetric.findMany.mockResolvedValue(
      baselineRows as never,
    );

    prismaMock.anomalyEvent.findFirst.mockResolvedValue(null);

    prismaMock.anomalyEvent.create.mockResolvedValue({
      id: "anomaly-err",
      pipelineId: "pipe-1",
      anomalyType: "error_rate_spike",
      severity: "critical",
      status: "open",
    } as never);

    const results = await evaluatePipeline({
      id: "pipe-1",
      environmentId: "env-1",
      environment: { teamId: "team-1" },
    });

    const errorSpike = results.find(
      (r) => r.anomalyType === "error_rate_spike",
    );
    expect(errorSpike).toBeDefined();
  });

  it("does NOT flag a pipeline with normal metrics", async () => {
    const baselineRows = generateRealisticBaseline();
    const normalSnapshot = generateAnomalySnapshot("normal");

    prismaMock.pipelineMetric.findFirst.mockResolvedValue({
      ...normalSnapshot,
      id: "m-latest",
      pipelineId: "pipe-1",
      nodeId: null,
      componentId: null,
      timestamp: new Date("2026-03-29T12:00:00Z"),
      eventsDiscarded: BigInt(0),
      bytesIn: BigInt(0),
      bytesOut: BigInt(0),
      utilization: 0,
    } as never);

    prismaMock.pipelineMetric.findMany.mockResolvedValue(
      baselineRows as never,
    );

    const results = await evaluatePipeline({
      id: "pipe-1",
      environmentId: "env-1",
      environment: { teamId: "team-1" },
    });

    expect(results).toHaveLength(0);
    expect(prismaMock.anomalyEvent.create).not.toHaveBeenCalled();
  });

  it("deduplicates anomalies within the cooldown window", async () => {
    const baselineRows = generateRealisticBaseline();
    const currentSnapshot = generateAnomalySnapshot("throughput_drop");

    prismaMock.pipelineMetric.findFirst.mockResolvedValue({
      ...currentSnapshot,
      id: "m-latest",
      pipelineId: "pipe-1",
      nodeId: null,
      componentId: null,
      timestamp: new Date("2026-03-29T12:00:00Z"),
      eventsDiscarded: BigInt(0),
      bytesIn: BigInt(0),
      bytesOut: BigInt(0),
      utilization: 0,
    } as never);

    prismaMock.pipelineMetric.findMany.mockResolvedValue(
      baselineRows as never,
    );

    // Existing open anomaly within dedup window
    prismaMock.anomalyEvent.findFirst.mockResolvedValue({
      id: "anomaly-existing",
      pipelineId: "pipe-1",
      anomalyType: "throughput_drop",
      status: "open",
      detectedAt: new Date("2026-03-29T10:00:00Z"),
    } as never);

    const results = await evaluatePipeline({
      id: "pipe-1",
      environmentId: "env-1",
      environment: { teamId: "team-1" },
    });

    // Should detect the anomaly but NOT create a new event (dedup)
    expect(prismaMock.anomalyEvent.create).not.toHaveBeenCalled();
  });

  it("handles pipeline with no metric data gracefully", async () => {
    prismaMock.pipelineMetric.findFirst.mockResolvedValue(null);

    const results = await evaluatePipeline({
      id: "pipe-no-data",
      environmentId: "env-1",
      environment: { teamId: "team-1" },
    });

    expect(results).toHaveLength(0);
  });

  it("handles pipeline with insufficient baseline gracefully", async () => {
    // Only 3 data points -- not enough for baseline
    const sparseRows = [
      {
        timestamp: new Date("2026-03-28T00:00:00Z"),
        eventsIn: BigInt(1000),
        errorsTotal: BigInt(5),
        latencyMeanMs: 45,
        componentId: null,
        pipelineId: "pipe-1",
      },
      {
        timestamp: new Date("2026-03-28T01:00:00Z"),
        eventsIn: BigInt(1100),
        errorsTotal: BigInt(6),
        latencyMeanMs: 47,
        componentId: null,
        pipelineId: "pipe-1",
      },
      {
        timestamp: new Date("2026-03-28T02:00:00Z"),
        eventsIn: BigInt(900),
        errorsTotal: BigInt(4),
        latencyMeanMs: 43,
        componentId: null,
        pipelineId: "pipe-1",
      },
    ];

    prismaMock.pipelineMetric.findFirst.mockResolvedValue({
      eventsIn: BigInt(50000),
      errorsTotal: BigInt(500),
      latencyMeanMs: 500,
      id: "m-latest",
      pipelineId: "pipe-1",
      nodeId: null,
      componentId: null,
      timestamp: new Date("2026-03-29T12:00:00Z"),
      eventsDiscarded: BigInt(0),
      bytesIn: BigInt(0),
      bytesOut: BigInt(0),
      utilization: 0,
    } as never);

    prismaMock.pipelineMetric.findMany.mockResolvedValue(
      sparseRows as never,
    );

    const results = await evaluatePipeline({
      id: "pipe-1",
      environmentId: "env-1",
      environment: { teamId: "team-1" },
    });

    // Insufficient baseline data -- should not flag anything
    expect(results).toHaveLength(0);
  });
});

describe("Statistical correctness", () => {
  it("computeBaseline returns accurate mean for known dataset", () => {
    const points: MetricDataPoint[] = [
      { timestamp: new Date(), value: 2 },
      { timestamp: new Date(), value: 4 },
      { timestamp: new Date(), value: 4 },
      { timestamp: new Date(), value: 4 },
      { timestamp: new Date(), value: 5 },
      { timestamp: new Date(), value: 5 },
      { timestamp: new Date(), value: 7 },
      { timestamp: new Date(), value: 9 },
    ];

    const baseline = computeBaseline(points);
    expect(baseline).not.toBeNull();
    // Mean = (2+4+4+4+5+5+7+9)/8 = 40/8 = 5
    expect(baseline!.mean).toBe(5);
    // Population stddev = sqrt(((2-5)^2 + (4-5)^2*3 + (5-5)^2*2 + (7-5)^2 + (9-5)^2) / 8)
    // = sqrt((9+1+1+1+0+0+4+16)/8) = sqrt(32/8) = sqrt(4) = 2
    expect(baseline!.stddev).toBe(2);
    expect(baseline!.sampleCount).toBe(8);
  });

  it("3-sigma detection correctly identifies outliers", () => {
    // Create a dataset with mean=100, stddev=10
    // Generate 168 points alternating between 90 and 110
    const points: MetricDataPoint[] = Array.from({ length: 168 }, (_, i) => ({
      timestamp: new Date(Date.now() - (168 - i) * 3600_000),
      value: i % 2 === 0 ? 110 : 90,
    }));

    // Verify baseline: mean=100, stddev=10
    const baseline = computeBaseline(points);
    expect(baseline!.mean).toBe(100);
    expect(baseline!.stddev).toBe(10);

    // Value just below 3 sigma: 100 + 2.9*10 = 129
    const borderline = detectAnomalies("pipe-1", "eventsIn", 129, points);
    // Below 3 sigma threshold, should not trigger
    expect(borderline).toHaveLength(0);

    // Value above 3 sigma: 131
    const anomalous = detectAnomalies("pipe-1", "eventsIn", 131, points);
    expect(anomalous).toHaveLength(1);
    expect(anomalous[0].anomalyType).toBe("throughput_spike");

    // Value below 3 sigma: 69
    const dropAnomaly = detectAnomalies("pipe-1", "eventsIn", 69, points);
    expect(dropAnomaly).toHaveLength(1);
    expect(dropAnomaly[0].anomalyType).toBe("throughput_drop");
  });
});
