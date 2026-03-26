import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Hoisted mock functions ─────────────────────────────────────────────────

const { mockRegistrySend, mockPublishPush, mockGetRedis } = vi.hoisted(
  () => ({
    mockRegistrySend: vi.fn(),
    mockPublishPush: vi.fn(),
    mockGetRedis: vi.fn(),
  }),
);

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/server/services/push-registry", () => ({
  pushRegistry: {
    send: mockRegistrySend,
  },
}));

vi.mock("@/server/services/redis-pubsub", () => ({
  publishPush: mockPublishPush,
}));

vi.mock("@/lib/redis", () => ({
  getRedis: mockGetRedis,
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { relayPush } from "@/server/services/push-broadcast";
import type { PushMessage } from "@/server/services/push-types";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("push-broadcast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("relayPush", () => {
    const nodeId = "node-42";
    const message: PushMessage = {
      type: "config_changed",
      reason: "deploy",
    };

    it("returns true and skips Redis when local delivery succeeds", () => {
      mockRegistrySend.mockReturnValue(true);

      const result = relayPush(nodeId, message);

      expect(result).toBe(true);
      expect(mockRegistrySend).toHaveBeenCalledWith(nodeId, message);
      expect(mockPublishPush).not.toHaveBeenCalled();
    });

    it("returns true and publishes via Redis when local delivery fails and Redis is available", () => {
      mockRegistrySend.mockReturnValue(false);
      mockGetRedis.mockReturnValue({}); // non-null = Redis available

      const result = relayPush(nodeId, message);

      expect(result).toBe(true);
      expect(mockRegistrySend).toHaveBeenCalledWith(nodeId, message);
      expect(mockPublishPush).toHaveBeenCalledWith(nodeId, message);
    });

    it("returns false when local delivery fails and no Redis is available", () => {
      mockRegistrySend.mockReturnValue(false);
      mockGetRedis.mockReturnValue(null);

      const result = relayPush(nodeId, message);

      expect(result).toBe(false);
      expect(mockRegistrySend).toHaveBeenCalledWith(nodeId, message);
      expect(mockPublishPush).not.toHaveBeenCalled();
    });

    it("passes correct nodeId and message to pushRegistry.send", () => {
      mockRegistrySend.mockReturnValue(true);

      const specificMessage: PushMessage = {
        type: "sample_request",
        requestId: "req-1",
        pipelineId: "pipe-1",
        componentKeys: ["comp-a"],
        limit: 10,
      };

      relayPush("node-99", specificMessage);

      expect(mockRegistrySend).toHaveBeenCalledWith("node-99", specificMessage);
    });

    it("passes correct nodeId and message to publishPush when relaying", () => {
      mockRegistrySend.mockReturnValue(false);
      mockGetRedis.mockReturnValue({});

      const actionMessage: PushMessage = {
        type: "action",
        action: "restart",
      };

      relayPush("node-77", actionMessage);

      expect(mockPublishPush).toHaveBeenCalledWith("node-77", actionMessage);
    });
  });
});
