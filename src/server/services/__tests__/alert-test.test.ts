import { describe, it, expect } from "vitest";
import type { PipelineMetricRow } from "@/server/services/metrics-query";
import {
  evaluateRuleHistory,
  metricToColumn,
  unsupportedPreviewReason,
  PIPELINE_PREVIEW_METRICS,
} from "@/server/services/alert-test";

function row(
  partial: Partial<PipelineMetricRow> & { timestamp: Date },
): PipelineMetricRow {
  return {
    timestamp: partial.timestamp,
    eventsIn: partial.eventsIn ?? BigInt(0),
    eventsOut: partial.eventsOut ?? BigInt(0),
    eventsDiscarded: partial.eventsDiscarded ?? BigInt(0),
    errorsTotal: partial.errorsTotal ?? BigInt(0),
    bytesIn: partial.bytesIn ?? BigInt(0),
    bytesOut: partial.bytesOut ?? BigInt(0),
    utilization: partial.utilization ?? 0,
    latencyMeanMs: partial.latencyMeanMs ?? null,
  };
}

/**
 * Build a series of rows at fixed bucket intervals.
 * Each entry is the latency value (ms); `null` means no data for that bucket.
 */
function latencySeries(values: Array<number | null>, gapSeconds = 30): PipelineMetricRow[] {
  const start = new Date("2026-01-01T00:00:00Z").getTime();
  return values.map((v, i) =>
    row({
      timestamp: new Date(start + i * gapSeconds * 1000),
      latencyMeanMs: v,
    }),
  );
}

describe("metricToColumn", () => {
  it("derives error_rate as percentage", () => {
    const r = row({
      timestamp: new Date(),
      eventsIn: BigInt(100),
      errorsTotal: BigInt(7),
    });
    expect(metricToColumn("error_rate", r)).toBeCloseTo(7);
  });

  it("returns 0 for error_rate when no input events", () => {
    const r = row({ timestamp: new Date() });
    expect(metricToColumn("error_rate", r)).toBe(0);
  });

  it("returns latencyMeanMs directly", () => {
    const r = row({ timestamp: new Date(), latencyMeanMs: 412 });
    expect(metricToColumn("latency_mean", r)).toBe(412);
  });

  it("returns null for unsupported metrics", () => {
    const r = row({ timestamp: new Date() });
    expect(metricToColumn("cpu_usage", r)).toBeNull();
    expect(metricToColumn("deploy_requested", r)).toBeNull();
  });
});

describe("unsupportedPreviewReason", () => {
  it("returns null for supported metrics", () => {
    for (const m of PIPELINE_PREVIEW_METRICS) {
      expect(unsupportedPreviewReason(m)).toBeNull();
    }
  });

  it("returns a reason for node-scoped metrics", () => {
    expect(unsupportedPreviewReason("cpu_usage")).toMatch(/node/i);
  });

  it("returns a reason for fleet metrics", () => {
    expect(unsupportedPreviewReason("fleet_error_rate")).toMatch(/fleet/i);
  });

  it("returns a reason for event metrics", () => {
    expect(unsupportedPreviewReason("deploy_requested")).toMatch(/event/i);
  });
});

describe("evaluateRuleHistory", () => {
  it("counts one fire when 5 consecutive breach buckets at 30s gap exceed durationSeconds=60", () => {
    // 10 buckets total: first 3 below threshold, next 5 above (breach), last 2 below.
    const rows = latencySeries([100, 110, 120, 300, 310, 320, 330, 340, 100, 110], 30);
    const result = evaluateRuleHistory({
      rows,
      metric: "latency_mean",
      condition: "gt",
      threshold: 250,
      durationSeconds: 60,
    });

    expect(result.series).toHaveLength(10);
    expect(result.wouldHaveFired).toBe(1);
    expect(result.breaches).toHaveLength(1);
    // First breach bucket is index 3, fire bucket is index 5 (after 60s of accumulated breach time)
    expect(result.breaches[0].start).toBe(rows[3].timestamp.getTime());
    expect(result.breaches[0].end).toBe(rows[5].timestamp.getTime());
  });

  it("supports the lt operator", () => {
    const rows = latencySeries([500, 50, 40, 30, 20, 500], 30);
    const result = evaluateRuleHistory({
      rows,
      metric: "latency_mean",
      condition: "lt",
      threshold: 100,
      durationSeconds: 60,
    });

    expect(result.wouldHaveFired).toBe(1);
  });

  it("returns 0 fires when breach is too brief", () => {
    // Only 2 consecutive breach buckets at 30s gap => 30s accumulated < 60s required
    const rows = latencySeries([100, 300, 310, 100, 100], 30);
    const result = evaluateRuleHistory({
      rows,
      metric: "latency_mean",
      condition: "gt",
      threshold: 250,
      durationSeconds: 60,
    });

    expect(result.wouldHaveFired).toBe(0);
    expect(result.breaches).toEqual([]);
  });

  it("counts a single fire for one continuous breach run, not per bucket", () => {
    // Long breach run — should be one window.
    const rows = latencySeries([100, 300, 310, 320, 330, 340, 350, 360, 100], 30);
    const result = evaluateRuleHistory({
      rows,
      metric: "latency_mean",
      condition: "gt",
      threshold: 250,
      durationSeconds: 60,
    });

    expect(result.wouldHaveFired).toBe(1);
  });

  it("counts multiple fires for separated breach runs", () => {
    // Two breach runs separated by a recovery
    const rows = latencySeries(
      [100, 300, 310, 320, 100, 300, 310, 320, 100],
      30,
    );
    const result = evaluateRuleHistory({
      rows,
      metric: "latency_mean",
      condition: "gt",
      threshold: 250,
      durationSeconds: 60,
    });

    expect(result.wouldHaveFired).toBe(2);
    expect(result.breaches).toHaveLength(2);
  });

  it("skips null metric values when projecting series", () => {
    const rows = latencySeries([null, null, 300, 310, 320, 330], 30);
    const result = evaluateRuleHistory({
      rows,
      metric: "latency_mean",
      condition: "gt",
      threshold: 250,
      durationSeconds: 60,
    });

    expect(result.series).toHaveLength(4);
  });

  it("breaks sustained breach runs when metric values are missing", () => {
    const rows = latencySeries([300, null, 310], 120);
    const result = evaluateRuleHistory({
      rows,
      metric: "latency_mean",
      condition: "gt",
      threshold: 250,
      durationSeconds: 60,
    });

    expect(result.series).toHaveLength(2);
    expect(result.wouldHaveFired).toBe(0);
  });

  it("works with durationSeconds=0 (instant fire on first breach)", () => {
    const rows = latencySeries([100, 300, 100], 30);
    const result = evaluateRuleHistory({
      rows,
      metric: "latency_mean",
      condition: "gt",
      threshold: 250,
      durationSeconds: 0,
    });

    expect(result.wouldHaveFired).toBe(1);
  });
});
