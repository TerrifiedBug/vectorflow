import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPollingInterval } from "@/hooks/use-polling-interval";
import type {
  SSEEvent,
  MetricUpdateEvent,
  FleetStatusEvent,
  LogEntryEvent,
  StatusChangeEvent,
} from "@/lib/sse/types";
import { __testing } from "@/hooks/use-sse";

const { subscribers, dispatchEvent } = __testing;

// ── Helpers ──────────────────────────────────────────────────────────

/** Register a subscriber directly in the module-level map. */
function registerSubscriber(
  id: string,
  eventType: SSEEvent["type"],
  callback: (event: SSEEvent) => void,
): void {
  subscribers.set(id, { eventType, callback });
}

// ── Fixtures ─────────────────────────────────────────────────────────

const metricEvent: MetricUpdateEvent = {
  type: "metric_update",
  nodeId: "node-1",
  pipelineId: "pipe-1",
  componentId: "comp-1",
  sample: {
    timestamp: Date.now(),
    receivedEventsRate: 50,
    sentEventsRate: 48,
    receivedBytesRate: 1024,
    sentBytesRate: 900,
    errorCount: 0,
    errorsRate: 0,
    discardedRate: 0,
    latencyMeanMs: 8,
  },
};

const fleetEvent: FleetStatusEvent = {
  type: "fleet_status",
  nodeId: "node-1",
  status: "healthy",
  timestamp: Date.now(),
};

const logEvent: LogEntryEvent = {
  type: "log_entry",
  nodeId: "node-1",
  pipelineId: "pipe-1",
  lines: ["2025-06-01 INFO pipeline started"],
};

const statusEvent: StatusChangeEvent = {
  type: "status_change",
  nodeId: "node-1",
  fromStatus: "running",
  toStatus: "stopped",
  reason: "user requested",
};

// ── Tests ────────────────────────────────────────────────────────────

describe("SSE lifecycle: polling state machine", () => {
  it("connected → disconnected → reconnecting → connected follows expected intervals", () => {
    const base = 5000;

    // Connected: polling suppressed (SSE pushes updates)
    expect(getPollingInterval("connected", base)).toBe(false);

    // Disconnected: fallback to polling, at least 30s floor
    expect(getPollingInterval("disconnected", base)).toBe(30_000);

    // Reconnecting: still polling at floor
    expect(getPollingInterval("reconnecting", base)).toBe(30_000);

    // Reconnected (back to connected): polling suppressed again
    expect(getPollingInterval("connected", base)).toBe(false);
  });

  it("base interval above 30s floor is preserved", () => {
    // If baseInterval > 30s, it should be used as-is (not clamped down)
    expect(getPollingInterval("disconnected", 60_000)).toBe(60_000);
    expect(getPollingInterval("reconnecting", 45_000)).toBe(45_000);
  });
});

describe("SSE lifecycle: subscriber fan-out", () => {
  beforeEach(() => {
    subscribers.clear();
  });

  it("multi-type fan-out: metric_update and status_change dispatch independently", () => {
    const metricCb = vi.fn();
    const statusCb = vi.fn();

    registerSubscriber("metric-sub", "metric_update", metricCb);
    registerSubscriber("status-sub", "status_change", statusCb);

    // Dispatch metric_update — only metric subscriber fires
    dispatchEvent(metricEvent);
    expect(metricCb).toHaveBeenCalledOnce();
    expect(metricCb).toHaveBeenCalledWith(metricEvent);
    expect(statusCb).not.toHaveBeenCalled();

    // Dispatch status_change — only status subscriber fires
    dispatchEvent(statusEvent);
    expect(statusCb).toHaveBeenCalledOnce();
    expect(statusCb).toHaveBeenCalledWith(statusEvent);
    expect(metricCb).toHaveBeenCalledOnce(); // still just the first call

    // Dispatch fleet_status — neither fires (no subscriber for that type)
    dispatchEvent(fleetEvent);
    expect(metricCb).toHaveBeenCalledOnce();
    expect(statusCb).toHaveBeenCalledOnce();
  });

  it("all four event types dispatch to their respective subscribers", () => {
    const metricCb = vi.fn();
    const fleetCb = vi.fn();
    const logCb = vi.fn();
    const statusChangeCb = vi.fn();

    registerSubscriber("sub-metric", "metric_update", metricCb);
    registerSubscriber("sub-fleet", "fleet_status", fleetCb);
    registerSubscriber("sub-log", "log_entry", logCb);
    registerSubscriber("sub-status", "status_change", statusChangeCb);

    dispatchEvent(metricEvent);
    dispatchEvent(fleetEvent);
    dispatchEvent(logEvent);
    dispatchEvent(statusEvent);

    expect(metricCb).toHaveBeenCalledOnce();
    expect(metricCb).toHaveBeenCalledWith(metricEvent);

    expect(fleetCb).toHaveBeenCalledOnce();
    expect(fleetCb).toHaveBeenCalledWith(fleetEvent);

    expect(logCb).toHaveBeenCalledOnce();
    expect(logCb).toHaveBeenCalledWith(logEvent);

    expect(statusChangeCb).toHaveBeenCalledOnce();
    expect(statusChangeCb).toHaveBeenCalledWith(statusEvent);
  });
});
