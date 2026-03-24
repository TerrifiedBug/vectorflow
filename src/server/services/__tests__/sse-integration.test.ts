import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { MetricStore } from "@/server/services/metric-store";
import { SSERegistry } from "@/server/services/sse-registry";
import type { MetricUpdateEvent, StatusChangeEvent, SSEEvent } from "@/lib/sse/types";

// ─── Helpers ────────────────────────────────────────────────────────────────

const NODE = "node-int";
const PIPELINE = "pipe-int";
const COMP_A = "comp-a";
const COMP_B = "comp-b";
const COMP_C = "comp-c";

/** Create a mock ReadableStreamDefaultController (same pattern as sse-registry.test.ts). */
function mockController(): ReadableStreamDefaultController {
  return {
    enqueue: vi.fn(),
    close: vi.fn(),
    desiredSize: 1,
    error: vi.fn(),
  } as unknown as ReadableStreamDefaultController;
}

/** Record two calls to recordTotals with a 5s gap so a rate sample is produced. */
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

/** Decode the SSE-encoded bytes from a controller.enqueue call and parse the JSON. */
function decodeEnqueued(ctrl: ReadableStreamDefaultController, callIndex = 0): SSEEvent {
  const encoded = (ctrl.enqueue as ReturnType<typeof vi.fn>).mock.calls[callIndex][0];
  const text = new TextDecoder().decode(encoded);
  const dataLine = text.split("\n").find((l: string) => l.startsWith("data: "));
  if (!dataLine) throw new Error(`No data: line in SSE frame: ${text}`);
  return JSON.parse(dataLine.slice(6)) as SSEEvent;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("MetricStore → SSERegistry integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flush → broadcast delivers to authorized connection only", () => {
    const store = new MetricStore();
    const registry = new SSERegistry();

    const ctrlA = mockController();
    const ctrlB = mockController();
    registry.register("conn-a", ctrlA, "user-1", ["env-1"]);
    registry.register("conn-b", ctrlB, "user-2", ["env-2"]);

    // Seed a single component and flush
    seedSample(store, NODE, PIPELINE, COMP_A);
    const events = store.flush(NODE, PIPELINE);
    expect(events).toHaveLength(1);

    // Broadcast to env-1 — only conn-a should receive it
    for (const event of events) {
      registry.broadcast(event, "env-1");
    }

    expect(ctrlA.enqueue).toHaveBeenCalledOnce();
    expect(ctrlB.enqueue).not.toHaveBeenCalled();

    // Verify the decoded payload matches the flushed event
    const decoded = decodeEnqueued(ctrlA);
    expect(decoded.type).toBe("metric_update");
    expect((decoded as MetricUpdateEvent).nodeId).toBe(NODE);
    expect((decoded as MetricUpdateEvent).pipelineId).toBe(PIPELINE);
    expect((decoded as MetricUpdateEvent).componentId).toBe(COMP_A);
    expect((decoded as MetricUpdateEvent).sample.receivedEventsRate).toBeGreaterThan(0);
  });

  it("flush with multiple components broadcasts one event per component", () => {
    const store = new MetricStore();
    const registry = new SSERegistry();

    const ctrl = mockController();
    registry.register("conn-a", ctrl, "user-1", ["env-1"]);

    // Seed 3 components
    seedSample(store, NODE, PIPELINE, COMP_A, 100);
    seedSample(store, NODE, PIPELINE, COMP_B, 200);
    seedSample(store, NODE, PIPELINE, COMP_C, 300);

    const events = store.flush(NODE, PIPELINE);
    expect(events).toHaveLength(3);

    // Broadcast each event
    for (const event of events) {
      registry.broadcast(event, "env-1");
    }

    // Controller should have received 3 separate enqueue calls
    expect(ctrl.enqueue).toHaveBeenCalledTimes(3);

    // Verify each decoded event has a distinct componentId
    const componentIds = [0, 1, 2].map((i) => {
      const decoded = decodeEnqueued(ctrl, i) as MetricUpdateEvent;
      return decoded.componentId;
    });
    expect(componentIds.sort()).toEqual([COMP_A, COMP_B, COMP_C]);
  });

  it("status_change event also respects environment scoping", () => {
    const registry = new SSERegistry();

    const ctrlA = mockController();
    const ctrlB = mockController();
    registry.register("conn-a", ctrlA, "user-1", ["env-1"]);
    registry.register("conn-b", ctrlB, "user-2", ["env-2"]);

    const statusEvent: StatusChangeEvent = {
      type: "status_change",
      nodeId: NODE,
      fromStatus: "running",
      toStatus: "stopped",
      reason: "user requested",
      pipelineId: PIPELINE,
    };

    // Broadcast to env-2 — only conn-b should receive it
    registry.broadcast(statusEvent, "env-2");

    expect(ctrlA.enqueue).not.toHaveBeenCalled();
    expect(ctrlB.enqueue).toHaveBeenCalledOnce();

    // Verify the decoded payload
    const decoded = decodeEnqueued(ctrlB) as StatusChangeEvent;
    expect(decoded.type).toBe("status_change");
    expect(decoded.toStatus).toBe("stopped");
  });

  it("subscriber receives events on flush (pub/sub → broadcast wiring)", () => {
    const store = new MetricStore();
    const registry = new SSERegistry();

    const ctrl = mockController();
    registry.register("conn-a", ctrl, "user-1", ["env-1"]);

    // Wire subscriber to broadcast — this mirrors what the heartbeat handler does
    const receivedEvents: MetricUpdateEvent[][] = [];
    store.subscribe((events) => {
      receivedEvents.push(events);
      for (const event of events) {
        registry.broadcast(event, "env-1");
      }
    });

    // Seed and flush — the subscriber should fire automatically
    seedSample(store, NODE, PIPELINE, COMP_A);
    store.flush(NODE, PIPELINE);

    // Subscriber was invoked
    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toHaveLength(1);

    // And the broadcast reached the controller
    expect(ctrl.enqueue).toHaveBeenCalledOnce();
    const decoded = decodeEnqueued(ctrl) as MetricUpdateEvent;
    expect(decoded.componentId).toBe(COMP_A);
  });
});
