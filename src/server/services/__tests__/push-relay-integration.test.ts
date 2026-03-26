import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Hoisted mock functions ─────────────────────────────────────────────────

const {
  mockRegistrySend,
  mockGetRedis,
  mockRedisPublish,
  mockInstanceId,
} = vi.hoisted(() => ({
  mockRegistrySend: vi.fn(),
  mockGetRedis: vi.fn(),
  mockRedisPublish: vi.fn().mockResolvedValue(1),
  mockInstanceId: "instance-A",
}));

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/server/services/push-registry", () => ({
  pushRegistry: {
    send: mockRegistrySend,
  },
}));

vi.mock("@/lib/redis", () => ({
  getRedis: mockGetRedis,
}));

vi.mock("@/server/services/sse-registry", () => ({
  sseRegistry: { broadcast: vi.fn() },
}));

vi.mock("@/server/services/metric-store", () => ({
  metricStore: { mergeSample: vi.fn() },
}));

vi.mock("@/server/services/leader-election", () => ({
  leaderElection: {
    get instanceId() {
      return mockInstanceId;
    },
    isLeader: () => false,
    start: vi.fn(),
    stop: vi.fn(),
    on: vi.fn(),
  },
}));

// ─── Import after mocks ────────────────────────────────────────────────────

import { relayPush } from "@/server/services/push-broadcast";
import { publishPush, _handleMessageForTest as handleMessage } from "@/server/services/redis-pubsub";
import type { PushMessage } from "@/server/services/push-types";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("push-relay integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("push published by instance A is received by instance B and delivered to local pushRegistry.send", () => {
    // Instance A publishes a push envelope
    const nodeId = "agent-node-1";
    const message: PushMessage = {
      type: "config_changed",
      pipelineId: "pipe-1",
      reason: "deploy",
    };

    // Simulate instance B receiving the envelope — origin is instance A, not B
    const envelope = JSON.stringify({
      type: "push",
      originInstanceId: "instance-OTHER",  // different from our instanceId
      payload: { nodeId, message },
    });

    handleMessage(envelope);

    // Instance B's pushRegistry.send should be called for the target agent
    expect(mockRegistrySend).toHaveBeenCalledTimes(1);
    expect(mockRegistrySend).toHaveBeenCalledWith(nodeId, message);
  });

  it("push message from same origin instance is ignored (echo prevention)", () => {
    const envelope = JSON.stringify({
      type: "push",
      originInstanceId: mockInstanceId, // same as our instance
      payload: {
        nodeId: "agent-node-1",
        message: { type: "config_changed", reason: "deploy" },
      },
    });

    handleMessage(envelope);

    // pushRegistry.send should NOT be called — echo prevention
    expect(mockRegistrySend).not.toHaveBeenCalled();
  });

  it("without Redis, relayPush returns false when agent not connected locally", () => {
    // No local connection
    mockRegistrySend.mockReturnValue(false);
    // No Redis
    mockGetRedis.mockReturnValue(null);

    const result = relayPush("unconnected-node", {
      type: "config_changed",
      reason: "deploy",
    });

    expect(result).toBe(false);
    expect(mockRegistrySend).toHaveBeenCalledTimes(1);
  });

  it("end-to-end: relayPush on instance A → publishPush → subscriber on instance B → pushRegistry.send on B", () => {
    // Instance A: agent is NOT connected locally
    mockRegistrySend.mockReturnValue(false);

    // Redis is available
    const fakeRedis = { publish: mockRedisPublish };
    mockGetRedis.mockReturnValue(fakeRedis);

    const nodeId = "agent-node-42";
    const message: PushMessage = {
      type: "action",
      action: "self_update",
      targetVersion: "1.2.3",
      downloadUrl: "https://example.com/agent",
      checksum: "sha256:abc123",
    };

    // Step 1: relayPush tries local, fails, relays via Redis
    const result = relayPush(nodeId, message);
    expect(result).toBe(true);

    // Step 2: Verify publishPush sent the correct envelope to Redis
    // (relayPush calls publishPush internally which calls redis.publish)
    expect(mockRedisPublish).toHaveBeenCalledTimes(1);
    const publishCall = mockRedisPublish.mock.calls[0]!;
    const [channel, publishedJson] = publishCall;
    expect(channel).toBe("vectorflow:events");

    const publishedEnvelope = JSON.parse(publishedJson);
    expect(publishedEnvelope.type).toBe("push");
    expect(publishedEnvelope.originInstanceId).toBe(mockInstanceId);
    expect(publishedEnvelope.payload).toEqual({ nodeId, message });

    // Step 3: Simulate instance B receiving this message
    // Instance B has a different instanceId, so echo prevention doesn't apply
    // We simulate by calling handleMessage with an envelope where originInstanceId
    // differs from mockInstanceId (which represents the receiving instance B)
    vi.clearAllMocks();

    // For instance B: the origin is instance A (a different instance)
    const envelopeFromA = JSON.stringify({
      ...publishedEnvelope,
      originInstanceId: "instance-A-different",
    });

    handleMessage(envelopeFromA);

    // Instance B's pushRegistry.send is called with the original nodeId and message
    expect(mockRegistrySend).toHaveBeenCalledTimes(1);
    expect(mockRegistrySend).toHaveBeenCalledWith(nodeId, message);
  });
});
