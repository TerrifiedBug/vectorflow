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

vi.mock("@/server/services/log-ingest", () => ({
  ingestLogs: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/server/services/sse-broadcast", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  errorLog: vi.fn(),
}));

import { authenticateAgent } from "@/server/services/agent-auth";
import { ingestLogs } from "@/server/services/log-ingest";
import { broadcastSSE } from "@/server/services/sse-broadcast";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/agent/logs", {
    method: "POST",
    headers: {
      authorization: "Bearer test-node-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/agent/logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(authenticateAgent).mockResolvedValueOnce(null);

    const { POST } = await import("@/app/api/agent/logs/route");
    const response = await POST(makeRequest([]));

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("ingests logs and broadcasts SSE events for each pipeline batch", async () => {
    const { POST } = await import("@/app/api/agent/logs/route");

    const body = [
      { pipelineId: "pipe-1", lines: ["log line 1", "log line 2"] },
      { pipelineId: "pipe-2", lines: ["log line 3"] },
    ];

    const response = await POST(makeRequest(body));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);

    // ingestLogs called for each batch
    expect(ingestLogs).toHaveBeenCalledTimes(2);
    expect(ingestLogs).toHaveBeenCalledWith(
      "node-1",
      "pipe-1",
      "env-1",
      ["log line 1", "log line 2"],
    );
    expect(ingestLogs).toHaveBeenCalledWith(
      "node-1",
      "pipe-2",
      "env-1",
      ["log line 3"],
    );

    // broadcastSSE called for each batch
    expect(broadcastSSE).toHaveBeenCalledTimes(2);
    expect(broadcastSSE).toHaveBeenCalledWith(
      {
        type: "log_entry",
        nodeId: "node-1",
        pipelineId: "pipe-1",
        lines: ["log line 1", "log line 2"],
      },
      "env-1",
    );
    expect(broadcastSSE).toHaveBeenCalledWith(
      {
        type: "log_entry",
        nodeId: "node-1",
        pipelineId: "pipe-2",
        lines: ["log line 3"],
      },
      "env-1",
    );
  });

  it("returns 400 for invalid payload (not an array)", async () => {
    const { POST } = await import("@/app/api/agent/logs/route");

    const response = await POST(
      makeRequest({ pipelineId: "pipe-1", lines: ["line"] }),
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Invalid payload");
  });

  it("skips empty line arrays (does not call ingestLogs)", async () => {
    const { POST } = await import("@/app/api/agent/logs/route");

    const body = [
      { pipelineId: "pipe-1", lines: [] },
      { pipelineId: "pipe-2", lines: ["actual log"] },
    ];

    const response = await POST(makeRequest(body));

    expect(response.status).toBe(200);

    // Only pipe-2 should trigger ingestLogs and broadcastSSE
    expect(ingestLogs).toHaveBeenCalledTimes(1);
    expect(ingestLogs).toHaveBeenCalledWith(
      "node-1",
      "pipe-2",
      "env-1",
      ["actual log"],
    );

    expect(broadcastSSE).toHaveBeenCalledTimes(1);
    expect(broadcastSSE).toHaveBeenCalledWith(
      {
        type: "log_entry",
        nodeId: "node-1",
        pipelineId: "pipe-2",
        lines: ["actual log"],
      },
      "env-1",
    );
  });
});
