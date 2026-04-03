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
});
