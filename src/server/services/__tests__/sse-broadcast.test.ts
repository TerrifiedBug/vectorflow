import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Hoisted mock functions ─────────────────────────────────────────────────

const {
  mockRegistryBroadcast,
  mockPublishSSE,
  mockPublishMetrics,
} = vi.hoisted(() => ({
  mockRegistryBroadcast: vi.fn(),
  mockPublishSSE: vi.fn(),
  mockPublishMetrics: vi.fn(),
}));

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/server/services/sse-registry", () => ({
  sseRegistry: {
    broadcast: mockRegistryBroadcast,
  },
}));

vi.mock("@/server/services/redis-pubsub", () => ({
  publishSSE: mockPublishSSE,
  publishMetrics: mockPublishMetrics,
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { broadcastSSE, broadcastMetrics } from "@/server/services/sse-broadcast";
import type { SSEEvent, MetricUpdateEvent } from "@/lib/sse/types";
import type { MetricSample } from "@/server/services/metric-store";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSample(): MetricSample {
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
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("sse-broadcast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("broadcastSSE", () => {
    it("calls both local sseRegistry.broadcast() and publishSSE()", () => {
      const event: SSEEvent = {
        type: "fleet_status",
        nodeId: "node-1",
        status: "online",
        timestamp: Date.now(),
      };

      broadcastSSE(event, "env-123");

      expect(mockRegistryBroadcast).toHaveBeenCalledWith(event, "env-123");
      expect(mockPublishSSE).toHaveBeenCalledWith(event, "env-123");
    });

    it("works when publishSSE is a no-op (Redis unavailable)", () => {
      const event: SSEEvent = {
        type: "fleet_status",
        nodeId: "node-1",
        status: "online",
        timestamp: Date.now(),
      };

      broadcastSSE(event, "env-123");

      expect(mockRegistryBroadcast).toHaveBeenCalledWith(event, "env-123");
      expect(mockPublishSSE).toHaveBeenCalledWith(event, "env-123");
    });
  });

  describe("broadcastMetrics", () => {
    it("calls publishMetrics for cross-instance delivery", () => {
      const events: MetricUpdateEvent[] = [
        {
          type: "metric_update",
          nodeId: "node-1",
          pipelineId: "pipe-1",
          componentId: "comp-a",
          sample: makeSample(),
        },
      ];

      broadcastMetrics(events, "env-456");

      expect(mockPublishMetrics).toHaveBeenCalledWith(events, "env-456");
      // Should NOT call local broadcast — caller handles that
      expect(mockRegistryBroadcast).not.toHaveBeenCalled();
    });
  });
});
