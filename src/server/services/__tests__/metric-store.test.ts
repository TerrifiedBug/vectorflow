import { vi, describe, it, expect, afterEach } from "vitest";
import { MetricStore } from "@/server/services/metric-store";
import type { MetricUpdateEvent } from "@/lib/sse/types";

// ─── Helpers ────────────────────────────────────────────────────────────────

const NODE = "node-test";
const PIPELINE = "pipe-1";
const COMP_A = "comp-a";
const COMP_B = "comp-b";
const COMP_C = "comp-c";

/** Record two calls to recordTotals with a 5s gap so a sample is produced. */
function seedSample(
  store: MetricStore,
  nodeId: string,
  pipelineId: string,
  componentId: string,
  eventsIn = 100,
): void {
  store.recordTotals(nodeId, pipelineId, componentId, {
    receivedEventsTotal: 0,
    sentEventsTotal: 0,
  });
  vi.advanceTimersByTime(5000);
  store.recordTotals(nodeId, pipelineId, componentId, {
    receivedEventsTotal: eventsIn,
    sentEventsTotal: eventsIn * 0.9,
    receivedBytesTotal: eventsIn * 50,
    sentBytesTotal: eventsIn * 45,
    errorsTotal: 1,
    discardedTotal: 0,
    latencyMeanSeconds: 0.012,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("MetricStore pub/sub", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribe receives flush events", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T00:00:00Z"));

    const store = new MetricStore();
    const received: MetricUpdateEvent[][] = [];
    store.subscribe((events) => received.push(events));

    seedSample(store, NODE, PIPELINE, COMP_A);
    store.flush(NODE, PIPELINE);

    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(1);
    expect(received[0][0].type).toBe("metric_update");
    expect(received[0][0].nodeId).toBe(NODE);
    expect(received[0][0].pipelineId).toBe(PIPELINE);
    expect(received[0][0].componentId).toBe(COMP_A);
    expect(received[0][0].sample.receivedEventsRate).toBeGreaterThan(0);
  });

  it("unsubscribe stops delivery", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T00:00:00Z"));

    const store = new MetricStore();
    const received: MetricUpdateEvent[][] = [];
    const id = store.subscribe((events) => received.push(events));

    seedSample(store, NODE, PIPELINE, COMP_A);

    store.unsubscribe(id);
    store.flush(NODE, PIPELINE);

    expect(received).toHaveLength(0);
  });

  it("multiple subscribers all notified", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T00:00:00Z"));

    const store = new MetricStore();
    const receivedA: MetricUpdateEvent[][] = [];
    const receivedB: MetricUpdateEvent[][] = [];
    store.subscribe((events) => receivedA.push(events));
    store.subscribe((events) => receivedB.push(events));

    seedSample(store, NODE, PIPELINE, COMP_A);
    store.flush(NODE, PIPELINE);

    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(1);
    // Both receive the same events (same content)
    expect(receivedA[0]).toEqual(receivedB[0]);
  });

  it("flush with no subscribers is a no-op", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T00:00:00Z"));

    const store = new MetricStore();
    seedSample(store, NODE, PIPELINE, COMP_A);

    // Should not throw and should return events
    const events = store.flush(NODE, PIPELINE);
    expect(events).toHaveLength(1);
    expect(store.subscriberCount).toBe(0);
  });

  it("flush for unknown node+pipeline returns empty array", () => {
    const store = new MetricStore();
    const events = store.flush("nonexistent-node", "nonexistent-pipe");
    expect(events).toEqual([]);
  });

  it("flush collects all components for a pipeline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T00:00:00Z"));

    const store = new MetricStore();
    const received: MetricUpdateEvent[][] = [];
    store.subscribe((events) => received.push(events));

    seedSample(store, NODE, PIPELINE, COMP_A, 100);
    seedSample(store, NODE, PIPELINE, COMP_B, 200);
    seedSample(store, NODE, PIPELINE, COMP_C, 300);

    store.flush(NODE, PIPELINE);

    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(3);

    const componentIds = received[0].map((e) => e.componentId).sort();
    expect(componentIds).toEqual([COMP_A, COMP_B, COMP_C]);
  });

  it("subscriberCount reflects active count", () => {
    const store = new MetricStore();
    expect(store.subscriberCount).toBe(0);

    const id1 = store.subscribe(() => {});
    const id2 = store.subscribe(() => {});
    expect(store.subscriberCount).toBe(2);

    store.unsubscribe(id1);
    expect(store.subscriberCount).toBe(1);

    store.unsubscribe(id2);
    expect(store.subscriberCount).toBe(0);
  });
});
