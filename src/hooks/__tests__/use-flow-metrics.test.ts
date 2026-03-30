import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MetricUpdateEvent } from "@/lib/sse/types";
import type { MetricSample } from "@/server/services/metric-store";
import type { NodeMetricsData } from "@/stores/flow-store";
import { deriveMetrics, type NodeKind } from "../use-flow-metrics";

// ── Fixtures ─────────────────────────────────────────────────────────

function makeSample(overrides: Partial<MetricSample> = {}): MetricSample {
  return {
    timestamp: Date.now(),
    receivedEventsRate: 100,
    sentEventsRate: 80,
    receivedBytesRate: 2048,
    sentBytesRate: 1024,
    errorCount: 0,
    errorsRate: 0,
    discardedRate: 0,
    latencyMeanMs: 5,
    ...overrides,
  };
}

function makeMetricEvent(
  overrides: Partial<MetricUpdateEvent> = {},
): MetricUpdateEvent {
  return {
    type: "metric_update",
    nodeId: "node-1",
    pipelineId: "pipe-1",
    componentId: "comp-source",
    sample: makeSample(),
    ...overrides,
  };
}

// ── Mock setup ───────────────────────────────────────────────────────
// We capture the subscribe callback so we can invoke it directly with
// synthetic events, avoiding the need for renderHook / React runtime.

const mockUnsubscribe = vi.fn();
const mockUpdateNodeMetrics = vi.fn();

vi.mock("@/hooks/use-sse", () => ({
  useSSE: () => ({
    subscribe: (): string => {
      return "sub-id-1";
    },
    unsubscribe: mockUnsubscribe,
    status: "connected" as const,
  }),
}));

// Minimal flow store mock — nodes array and updateNodeMetrics
const mockNodes: Array<{ type: string; data: { componentKey: string } }> = [];

vi.mock("@/stores/flow-store", () => ({
  useFlowStore: Object.assign(
    // The hook call itself (Zustand selector pattern) — not used by useFlowMetrics
    () => ({}),
    {
      getState: () => ({
        nodes: mockNodes,
        updateNodeMetrics: mockUpdateNodeMetrics,
      }),
    },
  ),
}));

// ── Hook exercise helper ─────────────────────────────────────────────
// Since we can't renderHook, we import the module and manually invoke
// the useEffect logic by triggering the subscribe callback.
// The mock captures the callback at import time (when useSSE() is called
// inside useFlowMetrics's useEffect). We simulate this by importing the
// module, which registers our mock, then we call subscribeCb directly.

// Force the module to load so mocks are wired up.
// The hook itself won't run its useEffect (no React runtime), but the
// subscribe/unsubscribe callbacks are captured by our mock.

// We need to trigger the useEffect manually. The cleanest approach is
// to test the hook's core logic via the exported deriveMetrics helper
// for pure logic, and test the integration (subscribe → buffer → store)
// by simulating what the useEffect callback does.

/**
 * Simulates what useFlowMetrics's useEffect subscriber callback does:
 * filters by pipelineId, accumulates buffer, resolves kind, calls updateNodeMetrics.
 */
function createHookSimulator(pipelineId: string) {
  const buffer = new Map<string, MetricSample[]>();
  const MAX_SAMPLES = 60;

  return {
    buffer,
    /** Feed an event through the hook's logic */
    dispatch(event: MetricUpdateEvent) {
      // This mirrors the exact logic in useFlowMetrics's subscribe callback
      if (event.pipelineId !== pipelineId) return;

      let samples = buffer.get(event.componentId);
      if (!samples) {
        samples = [];
        buffer.set(event.componentId, samples);
      }
      samples.push(event.sample);

      if (samples.length > MAX_SAMPLES) {
        buffer.set(event.componentId, samples.slice(-MAX_SAMPLES));
        samples = buffer.get(event.componentId)!;
      }

      const metricsMap = new Map<string, NodeMetricsData>();
      const nodes = mockNodes;

      for (const [componentId, componentSamples] of buffer) {
        const node = nodes.find(
          (n) => n.data.componentKey === componentId,
        );
        if (!node?.type) continue;

        const kind = node.type as NodeKind;
        const latest = componentSamples[componentSamples.length - 1];
        if (!latest) continue;

        metricsMap.set(
          componentId,
          deriveMetrics(kind, latest, componentSamples),
        );
      }

      if (metricsMap.size > 0) {
        mockUpdateNodeMetrics(metricsMap);
      }
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("deriveMetrics (pure function)", () => {
  it("source kind: eventsPerSec = receivedEventsRate, bytesPerSec = receivedBytesRate", () => {
    const sample = makeSample({
      receivedEventsRate: 150,
      sentEventsRate: 0,
      receivedBytesRate: 4096,
      sentBytesRate: 0,
    });
    const result = deriveMetrics("source", sample, [sample]);

    expect(result.eventsPerSec).toBe(150);
    expect(result.bytesPerSec).toBe(4096);
    expect(result.eventsInPerSec).toBeUndefined();
    expect(result.status).toBe("healthy");
    expect(result.samples).toHaveLength(1);
    expect(result.latencyMs).toBe(sample.latencyMeanMs);
  });

  it("transform kind: eventsPerSec = sentEventsRate, eventsInPerSec = receivedEventsRate, bytesPerSec = receivedBytesRate", () => {
    const sample = makeSample({
      receivedEventsRate: 200,
      sentEventsRate: 180,
      receivedBytesRate: 5000,
      sentBytesRate: 4500,
    });
    const result = deriveMetrics("transform", sample, [sample]);

    expect(result.eventsPerSec).toBe(180);
    expect(result.bytesPerSec).toBe(5000);
    expect(result.eventsInPerSec).toBe(200);
    expect(result.status).toBe("healthy");
  });

  it("sink kind: eventsPerSec = receivedEventsRate, bytesPerSec = sentBytesRate", () => {
    const sample = makeSample({
      receivedEventsRate: 300,
      sentEventsRate: 0,
      receivedBytesRate: 2000,
      sentBytesRate: 6000,
    });
    const result = deriveMetrics("sink", sample, [sample]);

    expect(result.eventsPerSec).toBe(300);
    expect(result.bytesPerSec).toBe(6000);
    expect(result.eventsInPerSec).toBeUndefined();
    expect(result.status).toBe("healthy");
  });

  it("status is 'degraded' when eventsPerSec is 0", () => {
    const sample = makeSample({
      receivedEventsRate: 0,
      sentEventsRate: 0,
    });
    const result = deriveMetrics("source", sample, [sample]);

    expect(result.eventsPerSec).toBe(0);
    expect(result.status).toBe("degraded");
  });

  it("source kind: falls back to sentEventsRate when receivedEventsRate is 0 (docker_logs sources)", () => {
    const sample = makeSample({
      receivedEventsRate: 0,
      sentEventsRate: 250,
      receivedBytesRate: 0,
      sentBytesRate: 3000,
    });
    const result = deriveMetrics("source", sample, [sample]);

    expect(result.eventsPerSec).toBe(250);
    expect(result.status).toBe("healthy");
  });
});

describe("useFlowMetrics integration (simulated hook logic)", () => {
  beforeEach(() => {
    mockNodes.length = 0;
    mockUpdateNodeMetrics.mockClear();
  });

  it("accumulates samples for the same componentId", () => {
    mockNodes.push({ type: "source", data: { componentKey: "comp-source" } });

    const sim = createHookSimulator("pipe-1");
    sim.dispatch(makeMetricEvent({ sample: makeSample({ timestamp: 1 }) }));
    sim.dispatch(makeMetricEvent({ sample: makeSample({ timestamp: 2 }) }));
    sim.dispatch(makeMetricEvent({ sample: makeSample({ timestamp: 3 }) }));

    expect(mockUpdateNodeMetrics).toHaveBeenCalledTimes(3);

    // Last call should have 3 samples
    const lastCall = mockUpdateNodeMetrics.mock.calls[2]![0] as Map<
      string,
      NodeMetricsData
    >;
    const metrics = lastCall.get("comp-source");
    expect(metrics).toBeDefined();
    expect(metrics!.samples).toHaveLength(3);
  });

  it("caps buffer at 60 samples", () => {
    mockNodes.push({ type: "source", data: { componentKey: "comp-source" } });

    const sim = createHookSimulator("pipe-1");
    for (let i = 0; i < 65; i++) {
      sim.dispatch(
        makeMetricEvent({ sample: makeSample({ timestamp: i }) }),
      );
    }

    const lastCall = mockUpdateNodeMetrics.mock.calls[64]![0] as Map<
      string,
      NodeMetricsData
    >;
    const metrics = lastCall.get("comp-source");
    expect(metrics!.samples).toHaveLength(60);
    // Oldest should be trimmed — first remaining timestamp should be 5 (65 - 60)
    expect(metrics!.samples![0]!.timestamp).toBe(5);
  });

  it("filters events by pipelineId", () => {
    mockNodes.push({ type: "source", data: { componentKey: "comp-source" } });

    const sim = createHookSimulator("pipe-1");
    sim.dispatch(
      makeMetricEvent({ pipelineId: "pipe-OTHER" }),
    );

    expect(mockUpdateNodeMetrics).not.toHaveBeenCalled();
  });

  it("gracefully skips unknown componentId with no matching node", () => {
    // No nodes in the store — componentId won't match anything
    const sim = createHookSimulator("pipe-1");

    // Should not throw
    expect(() =>
      sim.dispatch(makeMetricEvent({ componentId: "comp-unknown" })),
    ).not.toThrow();

    // updateNodeMetrics should NOT be called (metricsMap would be empty)
    expect(mockUpdateNodeMetrics).not.toHaveBeenCalled();
  });

  it("handles multiple components with different kinds in one buffer", () => {
    mockNodes.push(
      { type: "source", data: { componentKey: "comp-source" } },
      { type: "transform", data: { componentKey: "comp-transform" } },
      { type: "sink", data: { componentKey: "comp-sink" } },
    );

    const sim = createHookSimulator("pipe-1");

    sim.dispatch(
      makeMetricEvent({
        componentId: "comp-source",
        sample: makeSample({ receivedEventsRate: 100, receivedBytesRate: 2000 }),
      }),
    );
    sim.dispatch(
      makeMetricEvent({
        componentId: "comp-transform",
        sample: makeSample({ sentEventsRate: 90, receivedEventsRate: 100, receivedBytesRate: 3000 }),
      }),
    );
    sim.dispatch(
      makeMetricEvent({
        componentId: "comp-sink",
        sample: makeSample({ receivedEventsRate: 85, sentBytesRate: 5000 }),
      }),
    );

    // The last call should have all 3 components
    const lastCall = mockUpdateNodeMetrics.mock.calls[2]![0] as Map<
      string,
      NodeMetricsData
    >;

    const srcMetrics = lastCall.get("comp-source")!;
    expect(srcMetrics.eventsPerSec).toBe(100);
    expect(srcMetrics.bytesPerSec).toBe(2000);

    const txMetrics = lastCall.get("comp-transform")!;
    expect(txMetrics.eventsPerSec).toBe(90);
    expect(txMetrics.eventsInPerSec).toBe(100);
    expect(txMetrics.bytesPerSec).toBe(3000);

    const sinkMetrics = lastCall.get("comp-sink")!;
    expect(sinkMetrics.eventsPerSec).toBe(85);
    expect(sinkMetrics.bytesPerSec).toBe(5000);
  });
});
