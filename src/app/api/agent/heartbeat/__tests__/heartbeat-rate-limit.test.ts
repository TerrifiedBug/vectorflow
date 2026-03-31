// src/app/api/agent/heartbeat/__tests__/heartbeat-rate-limit.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies before importing the route
vi.mock("@/generated/prisma", () => ({
  Prisma: { DbNull: null, InputJsonValue: {} },
  DeploymentMode: { SINGLE: "SINGLE", FLEET: "FLEET" },
}));

vi.mock("@/lib/version", () => ({
  isVersionOlder: vi.fn(() => false),
}));

vi.mock("@/lib/sse/types", () => ({}));

vi.mock("@/app/api/_lib/ip-rate-limit", () => {
  let callCount = 0;
  return {
    checkTokenRateLimit: vi.fn(() => {
      callCount++;
      // Return 429 on the 31st call
      if (callCount > 30) {
        return new Response(JSON.stringify({ error: "Too many requests" }), {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": "60" },
        });
      }
      return null;
    }),
    // Keep checkIpRateLimit available in case other code references it
    checkIpRateLimit: vi.fn(() => null),
  };
});

vi.mock("@/server/services/agent-auth", () => ({
  authenticateAgent: vi.fn(() =>
    Promise.resolve({ nodeId: "node-1", environmentId: "env-1" }),
  ),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pipeline: { findMany: vi.fn(() => Promise.resolve([])) },
    vectorNode: {
      findUnique: vi.fn(() => Promise.resolve({ status: "HEALTHY" })),
      update: vi.fn(() =>
        Promise.resolve({ id: "node-1", environmentId: "env-1" }),
      ),
    },
    nodePipelineStatus: {
      findMany: vi.fn(() => Promise.resolve([])),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
    },
    nodeMetric: { create: vi.fn(() => Promise.resolve()) },
    nodeStatusEvent: { create: vi.fn(() => Promise.resolve()) },
    eventSampleRequest: {
      updateMany: vi.fn(() => Promise.resolve()),
      deleteMany: vi.fn(() => Promise.resolve()),
    },
  },
}));

vi.mock("@/server/services/fleet-health", () => ({
  checkNodeHealth: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/server/services/metrics-ingest", () => ({
  ingestMetrics: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/server/services/log-ingest", () => ({
  ingestLogs: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/server/services/metrics-cleanup", () => ({
  cleanupOldMetrics: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/server/services/metric-store", () => ({
  metricStore: {
    recordTotals: vi.fn(),
    flush: vi.fn(() => []),
  },
}));

vi.mock("@/server/services/sse-broadcast", () => ({
  broadcastSSE: vi.fn(),
  broadcastMetrics: vi.fn(),
}));

vi.mock("@/server/services/leader-election", () => ({
  isLeader: vi.fn(() => false),
}));

vi.mock("@/server/services/heartbeat-batch", () => ({
  batchUpsertPipelineStatuses: vi.fn(() => Promise.resolve()),
}));

import { checkTokenRateLimit } from "@/app/api/_lib/ip-rate-limit";

describe("POST /api/agent/heartbeat — rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls checkTokenRateLimit with endpoint 'heartbeat' and limit 30", async () => {
    const { POST } = await import("@/app/api/agent/heartbeat/route");

    const request = new Request("http://localhost/api/agent/heartbeat", {
      method: "POST",
      headers: {
        authorization: "Bearer test-node-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ pipelines: [] }),
    });

    await POST(request);

    expect(checkTokenRateLimit).toHaveBeenCalledWith(request, "heartbeat", 30);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    // Force the mock to return 429
    vi.mocked(checkTokenRateLimit).mockReturnValueOnce(
      new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "60" },
      }),
    );

    const { POST } = await import("@/app/api/agent/heartbeat/route");

    const request = new Request("http://localhost/api/agent/heartbeat", {
      method: "POST",
      headers: {
        authorization: "Bearer test-node-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ pipelines: [] }),
    });

    const response = await POST(request);
    expect(response.status).toBe(429);
  });
});
