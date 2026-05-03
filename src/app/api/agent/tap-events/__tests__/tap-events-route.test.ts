import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies before importing the route
vi.mock("@/app/api/_lib/ip-rate-limit", () => ({
  checkTokenRateLimit: vi.fn(() => null),
}));

vi.mock("@/server/services/agent-auth", () => ({
  authenticateAgent: vi.fn(() =>
    Promise.resolve({ nodeId: "node-1", environmentId: "env-1" }),
  ),
}));

vi.mock("@/server/services/sse-broadcast", () => ({
  broadcastSSE: vi.fn(),
}));

// Use a Map to simulate the persistent store. The route only calls getActiveTap,
// so we expose only what's needed.
const taps = new Map<string, {
  nodeId: string;
  pipelineId: string;
  componentId: string;
  startedAt: number;
}>();
vi.mock("@/server/services/active-taps", () => ({
  getActiveTap: vi.fn(async (requestId: string) => taps.get(requestId) ?? null),
}));

vi.mock("@/lib/logger", () => ({
  errorLog: vi.fn(),
}));

import { authenticateAgent } from "@/server/services/agent-auth";
import { broadcastSSE } from "@/server/services/sse-broadcast";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/agent/tap-events", {
    method: "POST",
    headers: {
      authorization: "Bearer test-node-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/agent/tap-events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taps.clear();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(authenticateAgent).mockResolvedValueOnce(null);

    const { POST } = await import("@/app/api/agent/tap-events/route");
    const response = await POST(makeRequest({}));

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("broadcasts tap events via SSE when events array is present", async () => {
    taps.set("req-1", {
      nodeId: "node-1",
      pipelineId: "pipe-1",
      componentId: "comp-1",
      startedAt: Date.now(),
    });

    const { POST } = await import("@/app/api/agent/tap-events/route");

    const body = {
      requestId: "req-1",
      pipelineId: "pipe-1",
      componentId: "comp-1",
      events: [{ message: "hello" }, { message: "world" }],
    };

    const response = await POST(makeRequest(body));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);

    expect(broadcastSSE).toHaveBeenCalledTimes(1);
    expect(broadcastSSE).toHaveBeenCalledWith(
      {
        type: "tap_event",
        requestId: "req-1",
        pipelineId: "pipe-1",
        componentId: "comp-1",
        events: [{ message: "hello" }, { message: "world" }],
      },
      "env-1",
    );
  });

  it("broadcasts tap_stopped when status is 'stopped'", async () => {
    taps.set("req-2", {
      nodeId: "node-1",
      pipelineId: "pipe-1",
      componentId: "comp-1",
      startedAt: Date.now(),
    });

    const { POST } = await import("@/app/api/agent/tap-events/route");

    const body = {
      requestId: "req-2",
      pipelineId: "pipe-1",
      componentId: "comp-1",
      status: "stopped",
      reason: "timeout",
    };

    const response = await POST(makeRequest(body));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);

    expect(broadcastSSE).toHaveBeenCalledTimes(1);
    expect(broadcastSSE).toHaveBeenCalledWith(
      {
        type: "tap_stopped",
        requestId: "req-2",
        reason: "timeout",
      },
      "env-1",
    );
  });

  it("returns 400 for missing requestId", async () => {
    const { POST } = await import("@/app/api/agent/tap-events/route");

    const body = {
      pipelineId: "pipe-1",
      componentId: "comp-1",
      events: [{ message: "hello" }],
    };

    const response = await POST(makeRequest(body));

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Invalid payload");
  });

  it("rejects tap events for a request assigned to a different node", async () => {
    taps.set("req-foreign-node", {
      nodeId: "node-2",
      pipelineId: "pipe-1",
      componentId: "comp-1",
      startedAt: Date.now(),
    });

    const { POST } = await import("@/app/api/agent/tap-events/route");

    const response = await POST(
      makeRequest({
        requestId: "req-foreign-node",
        pipelineId: "pipe-1",
        componentId: "comp-1",
        events: [{ message: "wrong node" }],
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(broadcastSSE).not.toHaveBeenCalled();
  });

  it("rejects tap events when pipeline or component does not match the request context", async () => {
    taps.set("req-1", {
      nodeId: "node-1",
      pipelineId: "pipe-1",
      componentId: "comp-1",
      startedAt: Date.now(),
    });

    const { POST } = await import("@/app/api/agent/tap-events/route");

    const response = await POST(
      makeRequest({
        requestId: "req-1",
        pipelineId: "pipe-1",
        componentId: "comp-other",
        events: [{ message: "wrong component" }],
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(broadcastSSE).not.toHaveBeenCalled();
  });
});
