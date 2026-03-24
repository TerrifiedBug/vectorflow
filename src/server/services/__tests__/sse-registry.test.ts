import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { SSERegistry } from "@/server/services/sse-registry";
import type { SSEEvent } from "@/lib/sse/types";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create a mock ReadableStreamDefaultController. */
function mockController(): ReadableStreamDefaultController {
  return {
    enqueue: vi.fn(),
    close: vi.fn(),
    desiredSize: 1,
    error: vi.fn(),
  } as unknown as ReadableStreamDefaultController;
}

const METRIC_EVENT: SSEEvent = {
  type: "metric_update",
  nodeId: "node-1",
  pipelineId: "pipe-1",
  componentId: "comp-1",
  sample: {
    timestamp: Date.now(),
    receivedEventsRate: 10,
    sentEventsRate: 9,
    receivedBytesRate: 500,
    sentBytesRate: 450,
    errorCount: 0,
    errorsRate: 0,
    discardedRate: 0,
    latencyMeanMs: 12,
  },
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("SSERegistry", () => {
  beforeEach(() => {
    // Fake timers prevent the keepalive setInterval from actually running
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("register adds connection, size reflects it", () => {
    const registry = new SSERegistry();
    const ctrl = mockController();

    registry.register("conn-1", ctrl, "user-1", ["env-1"]);

    expect(registry.size).toBe(1);
  });

  it("unregister removes connection", () => {
    const registry = new SSERegistry();
    const ctrl = mockController();

    registry.register("conn-1", ctrl, "user-1", ["env-1"]);
    registry.unregister("conn-1");

    expect(registry.size).toBe(0);
  });

  it("send encodes SSE event and enqueues", () => {
    const registry = new SSERegistry();
    const ctrl = mockController();

    registry.register("conn-1", ctrl, "user-1", ["env-1"]);
    const sent = registry.send("conn-1", METRIC_EVENT);

    expect(sent).toBe(true);
    expect(ctrl.enqueue).toHaveBeenCalledOnce();

    // Verify encoding format: "event: <type>\ndata: <json>\n\n"
    const encoded = (ctrl.enqueue as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const text = new TextDecoder().decode(encoded);
    expect(text).toContain("event: metric_update\n");
    expect(text).toContain("data: ");
    expect(text).toMatch(/\n\n$/);
    const dataLine = text.split("\n").find((l: string) => l.startsWith("data: "));
    expect(dataLine).toBeDefined();
    const parsed = JSON.parse(dataLine!.slice(6));
    expect(parsed.type).toBe("metric_update");
  });

  it("broadcast filters by environmentId (R022)", () => {
    const registry = new SSERegistry();
    const ctrlA = mockController();
    const ctrlB = mockController();

    registry.register("conn-a", ctrlA, "user-1", ["env-1"]);
    registry.register("conn-b", ctrlB, "user-2", ["env-2"]);

    registry.broadcast(METRIC_EVENT, "env-1");

    expect(ctrlA.enqueue).toHaveBeenCalledOnce();
    expect(ctrlB.enqueue).not.toHaveBeenCalled();
  });

  it("broadcast to shared environment reaches both connections", () => {
    const registry = new SSERegistry();
    const ctrlA = mockController();
    const ctrlB = mockController();

    registry.register("conn-a", ctrlA, "user-1", ["env-1", "env-2"]);
    registry.register("conn-b", ctrlB, "user-2", ["env-1"]);

    registry.broadcast(METRIC_EVENT, "env-1");

    expect(ctrlA.enqueue).toHaveBeenCalledOnce();
    expect(ctrlB.enqueue).toHaveBeenCalledOnce();
  });

  it("superAdmin connection receives events for any authorized environment", () => {
    const registry = new SSERegistry();
    const ctrl = mockController();

    // SuperAdmin has access to all environments
    registry.register("conn-admin", ctrl, "admin-1", ["env-1", "env-2", "env-3"]);

    registry.broadcast(METRIC_EVENT, "env-2");

    expect(ctrl.enqueue).toHaveBeenCalledOnce();
  });

  it("failed enqueue removes stale connection", () => {
    const registry = new SSERegistry();
    const ctrl = mockController();
    (ctrl.enqueue as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("stream closed");
    });

    registry.register("conn-stale", ctrl, "user-1", ["env-1"]);
    expect(registry.size).toBe(1);

    registry.broadcast(METRIC_EVENT, "env-1");

    expect(registry.size).toBe(0);
  });

  it("unregister with wrong controller is no-op", () => {
    const registry = new SSERegistry();
    const ctrlA = mockController();
    const ctrlB = mockController();

    registry.register("conn-1", ctrlA, "user-1", ["env-1"]);

    // Try to unregister with a different controller — should not remove
    registry.unregister("conn-1", ctrlB);

    expect(registry.size).toBe(1);
  });

  it("send returns false for unknown connection", () => {
    const registry = new SSERegistry();
    const sent = registry.send("nonexistent", METRIC_EVENT);
    expect(sent).toBe(false);
  });

  it("send removes dead connection on enqueue failure", () => {
    const registry = new SSERegistry();
    const ctrl = mockController();
    (ctrl.enqueue as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("stream closed");
    });

    registry.register("conn-dead", ctrl, "user-1", ["env-1"]);
    const sent = registry.send("conn-dead", METRIC_EVENT);

    expect(sent).toBe(false);
    expect(registry.size).toBe(0);
  });

  it("keepalive sends comments to all connections", () => {
    const registry = new SSERegistry();
    const ctrlA = mockController();
    const ctrlB = mockController();

    registry.register("conn-a", ctrlA, "user-1", ["env-1"]);
    registry.register("conn-b", ctrlB, "user-2", ["env-2"]);

    // Advance past the keepalive interval (30s)
    vi.advanceTimersByTime(30_000);

    expect(ctrlA.enqueue).toHaveBeenCalledOnce();
    expect(ctrlB.enqueue).toHaveBeenCalledOnce();

    // Verify keepalive format
    const encoded = (ctrlA.enqueue as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const text = new TextDecoder().decode(encoded);
    expect(text).toBe(": keepalive\n\n");
  });

  it("keepalive removes dead connections", () => {
    const registry = new SSERegistry();
    const ctrl = mockController();
    (ctrl.enqueue as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("stream closed");
    });

    registry.register("conn-dead", ctrl, "user-1", ["env-1"]);
    expect(registry.size).toBe(1);

    vi.advanceTimersByTime(30_000);

    expect(registry.size).toBe(0);
  });
});
