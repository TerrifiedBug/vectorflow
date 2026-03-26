import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Hoisted mock functions ─────────────────────────────────────────────────

const {
  mockPublish,
  mockSubscribe,
  mockDuplicate,
  mockSubscriberOn,
  mockRegistryBroadcast,
  mockMergeSample,
} = vi.hoisted(() => ({
  mockPublish: vi.fn().mockResolvedValue(1),
  mockSubscribe: vi.fn().mockResolvedValue(undefined),
  mockDuplicate: vi.fn(),
  mockSubscriberOn: vi.fn(),
  mockRegistryBroadcast: vi.fn(),
  mockMergeSample: vi.fn(),
}));

// ─── Module-level state for Redis availability toggling ─────────────────────

let mockRedisClient: {
  publish: typeof mockPublish;
  duplicate: typeof mockDuplicate;
  on: ReturnType<typeof vi.fn>;
} | null = null;

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
    on: mockSubscriberOn,
  };
}

// ─── Mocks ──────────────────────────────────────────────────────────────────

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
    broadcast: mockRegistryBroadcast,
  },
}));

vi.mock("@/server/services/metric-store", () => ({
  metricStore: {
    mergeSample: mockMergeSample,
  },
}));

// ─── Imports after mocks ────────────────────────────────────────────────────

import {
  initPubSub,
  publishSSE,
  publishMetrics,
  _handleMessageForTest as handleMessage,
  type PubSubEnvelope,
} from "@/server/services/redis-pubsub";
import { broadcastSSE, broadcastMetrics } from "@/server/services/sse-broadcast";
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

function makeSSEEvent(overrides: Partial<SSEEvent> = {}): SSEEvent {
  return {
    type: "fleet_status",
    nodeId: "node-1",
    status: "online",
    timestamp: Date.now(),
    ...overrides,
  } as SSEEvent;
}

function makeMetricEvent(overrides: Partial<MetricUpdateEvent> = {}): MetricUpdateEvent {
  return {
    type: "metric_update",
    nodeId: "node-1",
    pipelineId: "pipe-1",
    componentId: "comp-a",
    sample: makeSample(),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("redis-pubsub integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisClient = null;
  });

  describe("cross-instance SSE event flow", () => {
    it("instance A publishes an SSE event and instance B receives it via subscriber handler", () => {
      // Setup: Instance A has Redis available
      mockRedisClient = createMockRedis();
      mockDuplicate.mockReturnValue(createMockSubscriber());

      const event = makeSSEEvent({ nodeId: "node-42", status: "offline" });
      const envId = "env-prod";

      // Step 1: Instance A calls broadcastSSE (which does local + Redis publish)
      broadcastSSE(event, envId);

      // Verify: local broadcast was called on instance A
      expect(mockRegistryBroadcast).toHaveBeenCalledWith(event, envId);

      // Verify: Redis publish was called
      expect(mockPublish).toHaveBeenCalledTimes(1);
      const publishedMessage = mockPublish.mock.calls[0]?.[1];
      expect(publishedMessage).toBeDefined();

      const envelope: PubSubEnvelope = JSON.parse(publishedMessage);
      expect(envelope.type).toBe("sse");
      expect(envelope.originInstanceId).toBe("instance-A");
      expect(envelope.environmentId).toBe(envId);
      expect(envelope.payload).toEqual(event);

      // Step 2: Clear mocks to simulate instance B receiving the message
      vi.clearAllMocks();

      // Step 3: Simulate instance B subscriber handler receiving the message.
      // Instance B has a DIFFERENT instanceId, so the message from instance-A
      // will NOT be filtered by echo prevention.
      // We achieve this by calling handleMessage directly with the published envelope.
      // The mock leaderElection.instanceId is "instance-A" and the envelope says
      // originInstanceId: "instance-A" — so we need to change the origin to simulate
      // receiving from a different instance.
      const remoteEnvelope: PubSubEnvelope = {
        ...envelope,
        originInstanceId: "instance-B", // Simulates message from a different instance
      };
      handleMessage(JSON.stringify(remoteEnvelope));

      // Verify: sseRegistry.broadcast() was called on instance B with the correct event
      expect(mockRegistryBroadcast).toHaveBeenCalledTimes(1);
      expect(mockRegistryBroadcast).toHaveBeenCalledWith(event, envId);
    });

    it("instance A publishes metric batch and instance B merges and broadcasts each", () => {
      mockRedisClient = createMockRedis();
      mockDuplicate.mockReturnValue(createMockSubscriber());

      const events: MetricUpdateEvent[] = [
        makeMetricEvent({ componentId: "comp-a" }),
        makeMetricEvent({ componentId: "comp-b", sample: makeSample({ errorCount: 5 }) }),
      ];
      const envId = "env-staging";

      // Step 1: Instance A publishes metrics via broadcastMetrics (Redis-only)
      broadcastMetrics(events, envId);

      // Verify: local broadcast was NOT called (broadcastMetrics is Redis-only)
      expect(mockRegistryBroadcast).not.toHaveBeenCalled();

      // Verify: Redis publish was called
      expect(mockPublish).toHaveBeenCalledTimes(1);
      const publishedMessage = mockPublish.mock.calls[0]?.[1];
      const envelope: PubSubEnvelope = JSON.parse(publishedMessage);
      expect(envelope.type).toBe("metric");
      expect(envelope.payload).toEqual(events);

      // Step 2: Simulate instance B receiving the metric message
      vi.clearAllMocks();

      const remoteEnvelope: PubSubEnvelope = {
        ...envelope,
        originInstanceId: "instance-B",
      };
      handleMessage(JSON.stringify(remoteEnvelope));

      // Verify: metricStore.mergeSample() was called for EACH metric event
      expect(mockMergeSample).toHaveBeenCalledTimes(2);
      expect(mockMergeSample).toHaveBeenCalledWith(
        "node-1",
        "pipe-1",
        "comp-a",
        events[0]!.sample,
      );
      expect(mockMergeSample).toHaveBeenCalledWith(
        "node-1",
        "pipe-1",
        "comp-b",
        events[1]!.sample,
      );

      // Verify: sseRegistry.broadcast() was called for EACH metric event
      expect(mockRegistryBroadcast).toHaveBeenCalledTimes(2);
      expect(mockRegistryBroadcast).toHaveBeenCalledWith(events[0], envId);
      expect(mockRegistryBroadcast).toHaveBeenCalledWith(events[1], envId);
    });
  });

  describe("echo prevention", () => {
    it("self-published events (same instanceId) are filtered by subscriber handler", () => {
      mockRedisClient = createMockRedis();

      const event = makeSSEEvent();

      // Simulate receiving a message from the SAME instance (echo)
      const selfEnvelope: PubSubEnvelope = {
        type: "sse",
        originInstanceId: "instance-A", // Same as mock leaderElection.instanceId
        environmentId: "env-1",
        payload: event,
      };

      handleMessage(JSON.stringify(selfEnvelope));

      // Verify: sseRegistry.broadcast() was NOT called (echo prevention)
      expect(mockRegistryBroadcast).not.toHaveBeenCalled();
      expect(mockMergeSample).not.toHaveBeenCalled();
    });

    it("events from other instances pass through echo prevention", () => {
      mockRedisClient = createMockRedis();

      const event = makeSSEEvent();

      const remoteEnvelope: PubSubEnvelope = {
        type: "sse",
        originInstanceId: "instance-C", // Different instance
        environmentId: "env-1",
        payload: event,
      };

      handleMessage(JSON.stringify(remoteEnvelope));

      // Verify: broadcast was called
      expect(mockRegistryBroadcast).toHaveBeenCalledTimes(1);
    });
  });

  describe("single-instance degradation (no Redis)", () => {
    it("broadcastSSE degrades to local-only broadcast when Redis is unavailable", () => {
      // Redis is null — single-instance mode
      mockRedisClient = null;

      const event = makeSSEEvent();

      broadcastSSE(event, "env-local");

      // Verify: local broadcast still works
      expect(mockRegistryBroadcast).toHaveBeenCalledWith(event, "env-local");

      // Verify: Redis publish was NOT called (getRedis() returns null)
      expect(mockPublish).not.toHaveBeenCalled();
    });

    it("broadcastMetrics is a no-op when Redis is unavailable", () => {
      mockRedisClient = null;

      const events: MetricUpdateEvent[] = [makeMetricEvent()];

      broadcastMetrics(events, "env-local");

      // Verify: No Redis publish
      expect(mockPublish).not.toHaveBeenCalled();
      // Verify: No local broadcast (broadcastMetrics never does local)
      expect(mockRegistryBroadcast).not.toHaveBeenCalled();
    });

    it("initPubSub is a no-op when Redis is unavailable", async () => {
      mockRedisClient = null;

      // Should not throw
      await initPubSub();

      // Verify: No subscriber created
      expect(mockDuplicate).not.toHaveBeenCalled();
      expect(mockSubscribe).not.toHaveBeenCalled();
    });
  });

  describe("full round-trip simulation", () => {
    it("SSE event published by A is received by B, metric batch from A is merged into B", () => {
      mockRedisClient = createMockRedis();
      mockDuplicate.mockReturnValue(createMockSubscriber());

      const sseEvent = makeSSEEvent({ nodeId: "node-7", status: "online" });
      const metricEvents: MetricUpdateEvent[] = [
        makeMetricEvent({ nodeId: "node-7", pipelineId: "pipe-3", componentId: "src" }),
        makeMetricEvent({ nodeId: "node-7", pipelineId: "pipe-3", componentId: "sink" }),
        makeMetricEvent({ nodeId: "node-7", pipelineId: "pipe-3", componentId: "transform" }),
      ];
      const envId = "env-full-test";

      // Instance A: publish SSE event and metric batch
      broadcastSSE(sseEvent, envId);
      broadcastMetrics(metricEvents, envId);

      // Capture published messages
      expect(mockPublish).toHaveBeenCalledTimes(2);
      const sseMessage = mockPublish.mock.calls[0]?.[1];
      const metricMessage = mockPublish.mock.calls[1]?.[1];

      // Clear mocks to simulate instance B
      vi.clearAllMocks();

      // Instance B receives SSE message (from different instance)
      const sseEnvelope = JSON.parse(sseMessage);
      sseEnvelope.originInstanceId = "instance-X";
      handleMessage(JSON.stringify(sseEnvelope));

      expect(mockRegistryBroadcast).toHaveBeenCalledTimes(1);
      expect(mockRegistryBroadcast).toHaveBeenCalledWith(sseEvent, envId);

      vi.clearAllMocks();

      // Instance B receives metric message (from different instance)
      const metricEnvelope = JSON.parse(metricMessage);
      metricEnvelope.originInstanceId = "instance-X";
      handleMessage(JSON.stringify(metricEnvelope));

      // All 3 metric events merged and broadcast
      expect(mockMergeSample).toHaveBeenCalledTimes(3);
      expect(mockRegistryBroadcast).toHaveBeenCalledTimes(3);

      for (let i = 0; i < 3; i++) {
        expect(mockMergeSample).toHaveBeenCalledWith(
          "node-7",
          "pipe-3",
          metricEvents[i]!.componentId,
          metricEvents[i]!.sample,
        );
        expect(mockRegistryBroadcast).toHaveBeenCalledWith(metricEvents[i], envId);
      }
    });
  });
});
