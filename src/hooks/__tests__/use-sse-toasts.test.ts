import { describe, it, expect } from "vitest";
import {
  getToastConfig,
  isWithinCooldown,
  cleanExpiredEntries,
} from "@/hooks/use-sse-toasts";
import type { SSEEvent } from "@/lib/sse/types";

// ── getToastConfig ───────────────────────────────────────────────────

describe("getToastConfig", () => {
  it("returns error toast for pipeline crash with name", () => {
    const event: SSEEvent = {
      type: "status_change",
      nodeId: "n1",
      fromStatus: "RUNNING",
      toStatus: "CRASHED",
      reason: "OOM",
      pipelineId: "p1",
      pipelineName: "My Pipeline",
    };
    const result = getToastConfig(event);
    expect(result).toEqual({
      type: "error",
      message: 'Pipeline "My Pipeline" crashed',
      dedupeKey: "crash:p1",
    });
  });

  it("falls back to pipelineId when pipelineName is absent", () => {
    const event: SSEEvent = {
      type: "status_change",
      nodeId: "n1",
      fromStatus: "RUNNING",
      toStatus: "CRASHED",
      reason: "OOM",
      pipelineId: "p1",
    };
    const result = getToastConfig(event);
    expect(result).toEqual({
      type: "error",
      message: 'Pipeline "p1" crashed',
      dedupeKey: "crash:p1",
    });
  });

  it("returns success toast for deploy complete", () => {
    const event: SSEEvent = {
      type: "status_change",
      nodeId: "",
      fromStatus: "DEPLOYING",
      toStatus: "DEPLOYED",
      reason: "",
      pipelineId: "p2",
      pipelineName: "Logs Collector",
    };
    const result = getToastConfig(event);
    expect(result).toEqual({
      type: "success",
      message: 'Pipeline "Logs Collector" deployed successfully',
      dedupeKey: "deploy:p2",
    });
  });

  it("returns null for node offline via status_change (no server-side emitter yet)", () => {
    // Node offline detection requires a server-side watchdog that emits
    // fleet_status OFFLINE events. status_change events are only emitted
    // from the heartbeat handler (which requires an active heartbeat).
    const event: SSEEvent = {
      type: "status_change",
      nodeId: "n1",
      fromStatus: "HEALTHY",
      toStatus: "OFFLINE",
      reason: "heartbeat timeout",
    };
    expect(getToastConfig(event)).toBeNull();
  });

  it("returns warning toast for node offline via fleet_status", () => {
    const event: SSEEvent = {
      type: "fleet_status",
      nodeId: "n2",
      status: "OFFLINE",
      timestamp: Date.now(),
    };
    const result = getToastConfig(event);
    expect(result).toEqual({
      type: "warning",
      message: "Node went offline",
      dedupeKey: "offline:n2",
    });
  });

  it("returns null for unrelated status_change (STARTING → RUNNING)", () => {
    const event: SSEEvent = {
      type: "status_change",
      nodeId: "n1",
      fromStatus: "STARTING",
      toStatus: "RUNNING",
      reason: "",
    };
    expect(getToastConfig(event)).toBeNull();
  });

  it("returns null for node recovery (toStatus HEALTHY)", () => {
    const event: SSEEvent = {
      type: "status_change",
      nodeId: "n1",
      fromStatus: "OFFLINE",
      toStatus: "HEALTHY",
      reason: "heartbeat received",
    };
    expect(getToastConfig(event)).toBeNull();
  });

  it("returns null for fleet_status with non-OFFLINE status", () => {
    const event: SSEEvent = {
      type: "fleet_status",
      nodeId: "n1",
      status: "HEALTHY",
      timestamp: Date.now(),
    };
    expect(getToastConfig(event)).toBeNull();
  });

  it("returns null for metric_update events", () => {
    const event: SSEEvent = {
      type: "metric_update",
      nodeId: "n1",
      pipelineId: "p1",
      componentId: "c1",
      sample: {
        timestamp: Date.now(),
        receivedEventsRate: 100,
        sentEventsRate: 100,
        receivedBytesRate: 0,
        sentBytesRate: 0,
        errorCount: 0,
        errorsRate: 0,
        discardedRate: 0,
        latencyMeanMs: null,
      },
    };
    expect(getToastConfig(event)).toBeNull();
  });

  it("returns null for log_entry events", () => {
    const event: SSEEvent = {
      type: "log_entry",
      nodeId: "n1",
      pipelineId: "p1",
      lines: ["hello world"],
    };
    expect(getToastConfig(event)).toBeNull();
  });

  it("does not fire node offline when fromStatus is already OFFLINE", () => {
    const event: SSEEvent = {
      type: "status_change",
      nodeId: "n1",
      fromStatus: "OFFLINE",
      toStatus: "OFFLINE",
      reason: "still offline",
    };
    expect(getToastConfig(event)).toBeNull();
  });

  it("ignores CRASHED without pipelineId (not a pipeline-level event)", () => {
    const event: SSEEvent = {
      type: "status_change",
      nodeId: "n1",
      fromStatus: "RUNNING",
      toStatus: "CRASHED",
      reason: "node crash",
    };
    // No pipelineId → not a pipeline crash toast; also not OFFLINE → null
    expect(getToastConfig(event)).toBeNull();
  });

  it("produces same dedup key for repeated pipeline crash events", () => {
    const make = (): SSEEvent => ({
      type: "status_change",
      nodeId: "n1",
      fromStatus: "RUNNING",
      toStatus: "CRASHED",
      reason: "OOM",
      pipelineId: "p1",
      pipelineName: "Test",
    });
    const a = getToastConfig(make());
    const b = getToastConfig(make());
    expect(a!.dedupeKey).toBe(b!.dedupeKey);
  });
});

// ── Cooldown helpers ─────────────────────────────────────────────────

describe("isWithinCooldown", () => {
  it("returns false when key is not in map", () => {
    const map = new Map<string, number>();
    expect(isWithinCooldown(map, "crash:p1", Date.now())).toBe(false);
  });

  it("returns true when key was fired within 30s", () => {
    const now = Date.now();
    const map = new Map<string, number>([["crash:p1", now - 10_000]]);
    expect(isWithinCooldown(map, "crash:p1", now)).toBe(true);
  });

  it("returns false when key was fired over 30s ago", () => {
    const now = Date.now();
    const map = new Map<string, number>([["crash:p1", now - 31_000]]);
    expect(isWithinCooldown(map, "crash:p1", now)).toBe(false);
  });
});

describe("cleanExpiredEntries", () => {
  it("removes entries older than 30s", () => {
    const now = Date.now();
    const map = new Map<string, number>([
      ["old", now - 40_000],
      ["fresh", now - 5_000],
    ]);
    cleanExpiredEntries(map, now);
    expect(map.has("old")).toBe(false);
    expect(map.has("fresh")).toBe(true);
  });

  it("does nothing on empty map", () => {
    const map = new Map<string, number>();
    cleanExpiredEntries(map, Date.now());
    expect(map.size).toBe(0);
  });
});
