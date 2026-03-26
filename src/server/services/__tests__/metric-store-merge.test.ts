import { vi, describe, it, expect, afterEach } from "vitest";
import { MetricStore } from "@/server/services/metric-store";
import type { MetricSample } from "@/server/services/metric-store";

// ─── Helpers ────────────────────────────────────────────────────────────────

const NODE = "node-1";
const PIPELINE = "pipe-1";
const COMP_A = "comp-a";
const COMP_B = "comp-b";

function makeSample(overrides: Partial<MetricSample> = {}): MetricSample {
  return {
    timestamp: Date.now(),
    receivedEventsRate: 10,
    sentEventsRate: 9,
    receivedBytesRate: 500,
    sentBytesRate: 450,
    errorCount: 0,
    errorsRate: 0,
    discardedRate: 0,
    latencyMeanMs: 12,
    ...overrides,
  };
}

/** Record two calls to recordTotals with a 5s gap so a sample is produced. */
function seedSample(
  store: MetricStore,
  nodeId: string,
  pipelineId: string,
  componentId: string,
): void {
  store.recordTotals(nodeId, pipelineId, componentId, {
    receivedEventsTotal: 0,
    sentEventsTotal: 0,
  });
  vi.advanceTimersByTime(5000);
  store.recordTotals(nodeId, pipelineId, componentId, {
    receivedEventsTotal: 100,
    sentEventsTotal: 90,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("MetricStore.mergeSample", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("merges into an empty key", () => {
    const store = new MetricStore();
    const sample = makeSample({ timestamp: Date.now() });

    store.mergeSample(NODE, PIPELINE, COMP_A, sample);

    const result = store.getSamples(NODE, PIPELINE, COMP_A, 60);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(sample);
  });

  it("merges into an existing array", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T00:00:00Z"));

    const store = new MetricStore();
    seedSample(store, NODE, PIPELINE, COMP_A);

    const remoteSample = makeSample({ timestamp: Date.now() + 1000 });
    store.mergeSample(NODE, PIPELINE, COMP_A, remoteSample);

    const result = store.getSamples(NODE, PIPELINE, COMP_A, 999999);
    expect(result).toHaveLength(2); // 1 from seed + 1 merged
    expect(result[1]).toEqual(remoteSample);
  });

  it("respects MAX_SAMPLES cap (720)", () => {
    const store = new MetricStore();
    const baseTime = Date.now();

    // Fill to exactly MAX_SAMPLES
    for (let i = 0; i < 720; i++) {
      store.mergeSample(
        NODE,
        PIPELINE,
        COMP_A,
        makeSample({ timestamp: baseTime + i }),
      );
    }

    const beforeOverflow = store.getSamples(NODE, PIPELINE, COMP_A, 999999);
    expect(beforeOverflow).toHaveLength(720);

    // Add one more — should evict oldest
    store.mergeSample(
      NODE,
      PIPELINE,
      COMP_A,
      makeSample({ timestamp: baseTime + 720 }),
    );

    const afterOverflow = store.getSamples(NODE, PIPELINE, COMP_A, 999999);
    expect(afterOverflow).toHaveLength(720);
    // Oldest sample (timestamp baseTime + 0) should be gone
    expect(afterOverflow[0].timestamp).toBe(baseTime + 1);
    // Newest should be the one we just added
    expect(afterOverflow[afterOverflow.length - 1].timestamp).toBe(
      baseTime + 720,
    );
  });

  it("does not affect prevTotals", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T00:00:00Z"));

    const store = new MetricStore();

    // Set up prevTotals with an initial recordTotals call
    store.recordTotals(NODE, PIPELINE, COMP_A, {
      receivedEventsTotal: 100,
      sentEventsTotal: 90,
    });

    // Merge a remote sample — should not change prevTotals
    store.mergeSample(NODE, PIPELINE, COMP_A, makeSample());

    // Advance time and do another recordTotals — rate should be based on
    // the delta from 100, not affected by the merged sample
    vi.advanceTimersByTime(5000);
    const sample = store.recordTotals(NODE, PIPELINE, COMP_A, {
      receivedEventsTotal: 200,
      sentEventsTotal: 180,
    });

    expect(sample).not.toBeNull();
    // Rate = (200 - 100) / 5 = 20 events/sec
    expect(sample!.receivedEventsRate).toBe(20);
  });

  it("merged samples appear in getSamples() and getAllForPipeline()", () => {
    const store = new MetricStore();
    const sample = makeSample({ timestamp: Date.now() });

    store.mergeSample(NODE, PIPELINE, COMP_A, sample);
    store.mergeSample(NODE, PIPELINE, COMP_B, sample);

    // getSamples
    const samplesA = store.getSamples(NODE, PIPELINE, COMP_A, 999999);
    expect(samplesA).toHaveLength(1);
    expect(samplesA[0]).toEqual(sample);

    // getAllForPipeline
    const allForPipeline = store.getAllForPipeline(NODE, PIPELINE, 999999);
    expect(allForPipeline.size).toBe(2);
    expect(allForPipeline.get(COMP_A)).toHaveLength(1);
    expect(allForPipeline.get(COMP_B)).toHaveLength(1);
  });
});
