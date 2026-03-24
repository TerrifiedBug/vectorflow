import { describe, it, expect } from "vitest";
import { buildMetricContext } from "../metric-context";
import type { MetricSample } from "@/server/services/metric-store";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSample(overrides: Partial<MetricSample> = {}): MetricSample {
  return {
    timestamp: Date.now(),
    receivedEventsRate: 100,
    sentEventsRate: 95,
    receivedBytesRate: 5000,
    sentBytesRate: 4800,
    errorCount: 0,
    errorsRate: 0,
    discardedRate: 0,
    latencyMeanMs: 5.0,
    ...overrides,
  };
}

function makeMetrics(
  components: Record<string, Partial<MetricSample>[]>,
): Map<string, MetricSample[]> {
  const map = new Map<string, MetricSample[]>();
  for (const [id, overrides] of Object.entries(components)) {
    map.set(id, overrides.map((o) => makeSample(o)));
  }
  return map;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("buildMetricContext", () => {
  it("returns fallback text for an empty map", () => {
    const result = buildMetricContext(new Map());
    expect(result).toBe("No recent metrics available for this pipeline.");
  });

  it("returns fallback text when all sample arrays are empty", () => {
    const metrics = new Map<string, MetricSample[]>();
    metrics.set("kafka_source", []);
    metrics.set("remap_transform", []);
    const result = buildMetricContext(metrics);
    expect(result).toBe("No recent metrics available for this pipeline.");
  });

  it("formats a single component with all fields", () => {
    const metrics = makeMetrics({
      kafka_source: [
        {
          receivedEventsRate: 1234.5,
          sentEventsRate: 1230.2,
          errorCount: 2,
          errorsRate: 0.3,
          latencyMeanMs: 12.5,
        },
      ],
    });
    const result = buildMetricContext(metrics);
    expect(result).toContain('Component "kafka_source"');
    expect(result).toContain("recv=1234.5 ev/s");
    expect(result).toContain("sent=1230.2 ev/s");
    expect(result).toContain("errors=2 (0.3/s)");
    expect(result).toContain("latency=12.5ms");
  });

  it("shows N/A for null latency", () => {
    const metrics = makeMetrics({
      demo_source: [{ latencyMeanMs: null }],
    });
    const result = buildMetricContext(metrics);
    expect(result).toContain("latency=N/A");
    expect(result).not.toContain("latency=null");
  });

  it("uses the latest sample when multiple samples exist", () => {
    const metrics = new Map<string, MetricSample[]>();
    metrics.set("my_source", [
      makeSample({ receivedEventsRate: 10, errorsRate: 5 }),
      makeSample({ receivedEventsRate: 999, errorsRate: 1 }),
    ]);
    const result = buildMetricContext(metrics);
    expect(result).toContain("recv=999.0 ev/s");
    expect(result).toContain("(1.0/s)");
  });

  it("formats multiple components on separate lines", () => {
    const metrics = makeMetrics({
      source_a: [{}],
      transform_b: [{}],
      sink_c: [{}],
    });
    const result = buildMetricContext(metrics);
    const lines = result.split("\n").filter(Boolean);
    expect(lines.length).toBe(3);
    expect(result).toContain('Component "source_a"');
    expect(result).toContain('Component "transform_b"');
    expect(result).toContain('Component "sink_c"');
  });

  it("sorts components by error rate descending (≤20 components)", () => {
    const metrics = makeMetrics({
      low_errors: [{ errorsRate: 0.1 }],
      high_errors: [{ errorsRate: 10.0 }],
      mid_errors: [{ errorsRate: 2.5 }],
    });
    const result = buildMetricContext(metrics);
    const lines = result.split("\n").filter(Boolean);
    expect(lines[0]).toContain("high_errors");
    expect(lines[1]).toContain("mid_errors");
    expect(lines[2]).toContain("low_errors");
  });

  it("truncates to ~20 components when >20 are present", () => {
    const components: Record<string, Partial<MetricSample>[]> = {};
    for (let i = 0; i < 25; i++) {
      components[`component_${i.toString().padStart(2, "0")}`] = [
        { errorsRate: i * 0.1, receivedEventsRate: 100 + i },
      ];
    }
    const metrics = makeMetrics(components);
    const result = buildMetricContext(metrics);
    const lines = result.split("\n").filter(Boolean);
    // Top 10 by errors + top 10 by throughput (deduped) + summary line
    expect(lines.length).toBeLessThanOrEqual(21);
    expect(result).toContain("more components (omitted for brevity)");
  });

  it("keeps output under 8000 characters for 25 components", () => {
    const components: Record<string, Partial<MetricSample>[]> = {};
    for (let i = 0; i < 25; i++) {
      components[`component_with_a_longer_name_${i.toString().padStart(2, "0")}`] =
        [
          {
            receivedEventsRate: 1234.56789,
            sentEventsRate: 1230.12345,
            errorCount: i * 10,
            errorsRate: i * 0.5,
            latencyMeanMs: i * 2.5,
          },
        ];
    }
    const metrics = makeMetrics(components);
    const result = buildMetricContext(metrics);
    expect(result.length).toBeLessThan(8000);
  });

  it("includes highest-error components first in truncated output", () => {
    const components: Record<string, Partial<MetricSample>[]> = {};
    // 25 components — component_24 has highest error rate
    for (let i = 0; i < 25; i++) {
      components[`component_${i.toString().padStart(2, "0")}`] = [
        { errorsRate: i, receivedEventsRate: 50 },
      ];
    }
    const metrics = makeMetrics(components);
    const result = buildMetricContext(metrics);
    const lines = result.split("\n").filter(Boolean);
    // First line should be the highest error-rate component
    expect(lines[0]).toContain("component_24");
  });

  it("deduplicates components between error and throughput top-10 lists", () => {
    const components: Record<string, Partial<MetricSample>[]> = {};
    // Make component_00 the highest in both errors and throughput
    for (let i = 0; i < 25; i++) {
      components[`comp_${i.toString().padStart(2, "0")}`] = [
        {
          errorsRate: i === 0 ? 100 : i * 0.1,
          receivedEventsRate: i === 0 ? 9999 : 100 + i,
        },
      ];
    }
    const metrics = makeMetrics(components);
    const result = buildMetricContext(metrics);
    // comp_00 should appear exactly once despite being top of both lists
    const occurrences = result.split('comp_00"').length - 1;
    expect(occurrences).toBe(1);
  });
});
