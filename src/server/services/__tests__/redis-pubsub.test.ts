import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ─── Hoisted mock functions ─────────────────────────────────────────────────
// vi.hoisted() ensures these are available inside vi.mock() factories

const {
  mockPublish,
  mockSubscribe,
  mockUnsubscribe,
  mockDisconnect,
  mockDuplicate,
  mockSubscriberOn,
  mockBroadcast,
  mockMergeSample,
} = vi.hoisted(() => ({
  mockPublish: vi.fn().mockResolvedValue(1),
  mockSubscribe: vi.fn().mockResolvedValue(undefined),
  mockUnsubscribe: vi.fn().mockResolvedValue(undefined),
  mockDisconnect: vi.fn(),
  mockDuplicate: vi.fn(),
  mockSubscriberOn: vi.fn(),
  mockBroadcast: vi.fn(),
  mockMergeSample: vi.fn(),
}));

// ─── Mocks ──────────────────────────────────────────────────────────────────

let mockRedisClient: ReturnType<typeof createMockRedis> | null = null;

function createMockRedis() {
  return {
    publish: mockPublish,
    duplicate: mockDuplicate,
    on: vi.fn(),
  };
}

function createMockSubscriber() {
  return {
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    disconnect: mockDisconnect,
    on: mockSubscriberOn,
  };
}

vi.mock("@/lib/redis", () => ({
  getRedis: vi.fn(() => mockRedisClient),
}));

vi.mock("@/server/services/leader-election", () => ({
  leaderElection: {
    instanceId: "instance-A",
  },
}));

vi.mock("@/server/services/sse-registry", () => ({
  sseRegistry: {
    broadcast: mockBroadcast,
  },
}));

vi.mock("@/server/services/metric-store", () => ({
  metricStore: {
    mergeSample: mockMergeSample,
  },
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import {
  initPubSub,
  shutdownPubSub,
  publishSSE,
  publishMetrics,
  _handleMessageForTest as handleMessage,
} from "@/server/services/redis-pubsub";
import { getRedis } from "@/lib/redis";
import type { SSEEvent, MetricUpdateEvent } from "@/lib/sse/types";
import type { MetricSample } from "@/server/services/metric-store";

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("redis-pubsub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisClient = null;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    await shutdownPubSub();
    vi.restoreAllMocks();
  });

  // ── initPubSub ──────────────────────────────────────────────────────────

  describe("initPubSub", () => {
    it("creates subscriber via duplicate() when Redis is available", async () => {
      const mockSub = createMockSubscriber();
      mockRedisClient = createMockRedis();
      mockDuplicate.mockReturnValue(mockSub);
      vi.mocked(getRedis).mockReturnValue(mockRedisClient as never);

      await initPubSub();

      expect(mockDuplicate).toHaveBeenCalledOnce();
      expect(mockSub.subscribe).toHaveBeenCalledWith("vectorflow:events");
      expect(mockSub.on).toHaveBeenCalledWith("error", expect.any(Function));
      expect(mockSub.on).toHaveBeenCalledWith("message", expect.any(Function));
    });

    it("is a no-op when Redis is not available", async () => {
      vi.mocked(getRedis).mockReturnValue(null);

      await initPubSub();

      expect(mockDuplicate).not.toHaveBeenCalled();
      expect(mockSubscribe).not.toHaveBeenCalled();
    });
  });

  // ── publishSSE ──────────────────────────────────────────────────────────

  describe("publishSSE", () => {
    it("publishes correct envelope to Redis", () => {
      mockRedisClient = createMockRedis();
      vi.mocked(getRedis).mockReturnValue(mockRedisClient as never);

      const event: SSEEvent = {
        type: "fleet_status",
        nodeId: "node-1",
        status: "online",
        timestamp: Date.now(),
      };

      publishSSE(event, "env-123");

      expect(mockPublish).toHaveBeenCalledOnce();
      const [channel, payload] = mockPublish.mock.calls[0];
      expect(channel).toBe("vectorflow:events");
      const parsed = JSON.parse(payload);
      expect(parsed).toEqual({
        type: "sse",
        originInstanceId: "instance-A",
        environmentId: "env-123",
        payload: event,
      });
    });

    it("is a no-op when Redis is unavailable", () => {
      vi.mocked(getRedis).mockReturnValue(null);

      const event: SSEEvent = {
        type: "fleet_status",
        nodeId: "node-1",
        status: "online",
        timestamp: Date.now(),
      };

      publishSSE(event, "env-123");

      expect(mockPublish).not.toHaveBeenCalled();
    });

    it("catches and logs publish errors", async () => {
      mockRedisClient = createMockRedis();
      const publishError = new Error("Connection lost");
      mockPublish.mockRejectedValueOnce(publishError);
      vi.mocked(getRedis).mockReturnValue(mockRedisClient as never);

      const event: SSEEvent = {
        type: "fleet_status",
        nodeId: "node-1",
        status: "online",
        timestamp: Date.now(),
      };

      publishSSE(event, "env-123");

      // Wait for the catch handler to execute
      await vi.waitFor(() => {
        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining("Publish SSE error: Connection lost"),
        );
      });
    });
  });

  // ── publishMetrics ──────────────────────────────────────────────────────

  describe("publishMetrics", () => {
    it("publishes correct envelope to Redis", () => {
      mockRedisClient = createMockRedis();
      vi.mocked(getRedis).mockReturnValue(mockRedisClient as never);

      const events: MetricUpdateEvent[] = [
        {
          type: "metric_update",
          nodeId: "node-1",
          pipelineId: "pipe-1",
          componentId: "comp-a",
          sample: makeSample(),
        },
      ];

      publishMetrics(events, "env-456");

      expect(mockPublish).toHaveBeenCalledOnce();
      const [channel, payload] = mockPublish.mock.calls[0];
      expect(channel).toBe("vectorflow:events");
      const parsed = JSON.parse(payload);
      expect(parsed.type).toBe("metric");
      expect(parsed.originInstanceId).toBe("instance-A");
      expect(parsed.environmentId).toBe("env-456");
      expect(parsed.payload).toEqual(events);
    });
  });

  // ── Subscriber message handler ──────────────────────────────────────────

  describe("subscriber message handler", () => {
    it("delivers SSE events to sseRegistry.broadcast()", () => {
      const event: SSEEvent = {
        type: "fleet_status",
        nodeId: "node-1",
        status: "online",
        timestamp: Date.now(),
      };

      const envelope = {
        type: "sse",
        originInstanceId: "instance-B", // different instance
        environmentId: "env-123",
        payload: event,
      };

      handleMessage(JSON.stringify(envelope));

      expect(mockBroadcast).toHaveBeenCalledWith(event, "env-123");
    });

    it("delivers metric events to metricStore.mergeSample() and sseRegistry.broadcast()", () => {
      const sample = makeSample();
      const events: MetricUpdateEvent[] = [
        {
          type: "metric_update",
          nodeId: "node-1",
          pipelineId: "pipe-1",
          componentId: "comp-a",
          sample,
        },
        {
          type: "metric_update",
          nodeId: "node-1",
          pipelineId: "pipe-1",
          componentId: "comp-b",
          sample,
        },
      ];

      const envelope = {
        type: "metric",
        originInstanceId: "instance-B",
        environmentId: "env-456",
        payload: events,
      };

      handleMessage(JSON.stringify(envelope));

      expect(mockMergeSample).toHaveBeenCalledTimes(2);
      expect(mockMergeSample).toHaveBeenCalledWith(
        "node-1",
        "pipe-1",
        "comp-a",
        sample,
      );
      expect(mockMergeSample).toHaveBeenCalledWith(
        "node-1",
        "pipe-1",
        "comp-b",
        sample,
      );
      expect(mockBroadcast).toHaveBeenCalledTimes(2);
      expect(mockBroadcast).toHaveBeenCalledWith(events[0], "env-456");
      expect(mockBroadcast).toHaveBeenCalledWith(events[1], "env-456");
    });

    it("filters self-published messages (echo prevention)", () => {
      const envelope = {
        type: "sse",
        originInstanceId: "instance-A", // same as our instance
        environmentId: "env-123",
        payload: {
          type: "fleet_status",
          nodeId: "node-1",
          status: "online",
          timestamp: Date.now(),
        },
      };

      handleMessage(JSON.stringify(envelope));

      expect(mockBroadcast).not.toHaveBeenCalled();
      expect(mockMergeSample).not.toHaveBeenCalled();
    });

    it("handles malformed messages without crashing", () => {
      handleMessage("not valid json at all {{{");

      expect(mockBroadcast).not.toHaveBeenCalled();
      expect(mockMergeSample).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("Malformed message"),
      );
    });
  });

  // ── shutdownPubSub ──────────────────────────────────────────────────────

  describe("shutdownPubSub", () => {
    it("unsubscribes and disconnects subscriber", async () => {
      const mockSub = createMockSubscriber();
      mockRedisClient = createMockRedis();
      mockDuplicate.mockReturnValue(mockSub);
      vi.mocked(getRedis).mockReturnValue(mockRedisClient as never);

      await initPubSub();
      await shutdownPubSub();

      expect(mockSub.unsubscribe).toHaveBeenCalledWith("vectorflow:events");
      expect(mockSub.disconnect).toHaveBeenCalledOnce();
    });
  });
});
