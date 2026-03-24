import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SSEEvent, MetricUpdateEvent, FleetStatusEvent } from "@/lib/sse/types";
import { __testing } from "../use-sse";

const { subscribers, dispatchEvent } = __testing;

// ── Helpers ──────────────────────────────────────────────────────────

/** Register a subscriber directly in the module-level map (mirrors what useSSE().subscribe does). */
function registerSubscriber(
  id: string,
  eventType: SSEEvent["type"],
  callback: (event: SSEEvent) => void,
): void {
  subscribers.set(id, { eventType, callback });
}

/** Remove a subscriber directly from the module-level map (mirrors useSSE().unsubscribe). */
function removeSubscriber(id: string): void {
  subscribers.delete(id);
}

// ── Test fixtures ────────────────────────────────────────────────────

const metricEvent: MetricUpdateEvent = {
  type: "metric_update",
  nodeId: "node-1",
  pipelineId: "pipe-1",
  componentId: "comp-1",
  sample: {
    timestamp: Date.now(),
    receivedEventsRate: 100,
    sentEventsRate: 95,
    receivedBytesRate: 1024,
    sentBytesRate: 900,
    errorCount: 2,
    errorsRate: 0.1,
    discardedRate: 0,
    latencyMeanMs: 12,
  },
};

const fleetEvent: FleetStatusEvent = {
  type: "fleet_status",
  nodeId: "node-1",
  status: "healthy",
  timestamp: Date.now(),
};

// ── Tests ────────────────────────────────────────────────────────────

describe("useSSE module-level subscriber dispatch", () => {
  beforeEach(() => {
    // Clear the shared map between tests to prevent state leaks
    subscribers.clear();
  });

  it("subscriber from a second hook instance receives dispatched events", () => {
    // Simulates two independent hook instances registering subscribers.
    // Before the fix, only the first instance's subscribers would fire.
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    registerSubscriber("instance-1-sub", "metric_update", cb1);
    registerSubscriber("instance-2-sub", "metric_update", cb2);

    dispatchEvent(metricEvent);

    expect(cb1).toHaveBeenCalledOnce();
    expect(cb1).toHaveBeenCalledWith(metricEvent);
    expect(cb2).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledWith(metricEvent);
  });

  it("unsubscribe removes from shared map — callback no longer fires", () => {
    const cb = vi.fn();
    registerSubscriber("sub-to-remove", "metric_update", cb);

    // Dispatch once — should fire
    dispatchEvent(metricEvent);
    expect(cb).toHaveBeenCalledOnce();

    // Remove and dispatch again — should not fire
    removeSubscriber("sub-to-remove");
    dispatchEvent(metricEvent);
    expect(cb).toHaveBeenCalledOnce(); // still just the first call

    // Verify the map is clean
    expect(subscribers.has("sub-to-remove")).toBe(false);
  });

  it("multiple subscribers for the same event type all fire", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cb3 = vi.fn();

    registerSubscriber("sub-a", "fleet_status", cb1);
    registerSubscriber("sub-b", "fleet_status", cb2);
    registerSubscriber("sub-c", "fleet_status", cb3);

    dispatchEvent(fleetEvent);

    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
    expect(cb3).toHaveBeenCalledOnce();
    // All received the same event
    expect(cb1).toHaveBeenCalledWith(fleetEvent);
    expect(cb2).toHaveBeenCalledWith(fleetEvent);
    expect(cb3).toHaveBeenCalledWith(fleetEvent);
  });

  it("dispatch only fires subscribers matching the event type", () => {
    const metricCb = vi.fn();
    const fleetCb = vi.fn();

    registerSubscriber("metric-sub", "metric_update", metricCb);
    registerSubscriber("fleet-sub", "fleet_status", fleetCb);

    dispatchEvent(metricEvent);

    expect(metricCb).toHaveBeenCalledOnce();
    expect(fleetCb).not.toHaveBeenCalled();
  });

  it("subscriber error does not break dispatch to other subscribers", () => {
    const failingCb = vi.fn(() => {
      throw new Error("subscriber blew up");
    });
    const healthyCb = vi.fn();

    registerSubscriber("failing-sub", "metric_update", failingCb);
    registerSubscriber("healthy-sub", "metric_update", healthyCb);

    // Should not throw, and healthyCb should still fire
    expect(() => dispatchEvent(metricEvent)).not.toThrow();
    expect(failingCb).toHaveBeenCalledOnce();
    expect(healthyCb).toHaveBeenCalledOnce();
  });

  it("subscribers map size reflects registrations from multiple instances", () => {
    expect(subscribers.size).toBe(0);

    registerSubscriber("a", "metric_update", vi.fn());
    registerSubscriber("b", "fleet_status", vi.fn());
    registerSubscriber("c", "log_entry", vi.fn());

    expect(subscribers.size).toBe(3);

    removeSubscriber("b");
    expect(subscribers.size).toBe(2);
    expect(subscribers.has("b")).toBe(false);
  });
});
