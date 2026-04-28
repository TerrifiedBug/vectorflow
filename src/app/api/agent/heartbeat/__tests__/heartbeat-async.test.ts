import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ── Mocks (must be declared before importing the module under test) ──

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/agent-auth", () => ({
  authenticateAgent: vi.fn(),
}));

vi.mock("@/server/services/alert-evaluator", () => ({
  evaluateAlerts: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/server/services/fleet-health", () => ({
  checkNodeHealth: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/metrics-ingest", () => ({
  ingestMetrics: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/log-ingest", () => ({
  ingestLogs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/metrics-cleanup", () => ({
  cleanupOldMetrics: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/heartbeat-batch", () => ({
  batchUpsertPipelineStatuses: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/channels", () => ({
  deliverToChannels: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/delivery-tracking", () => ({
  trackChannelDelivery: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/metric-store", () => ({
  metricStore: { recordTotals: vi.fn(), flush: vi.fn().mockReturnValue([]) },
}));

vi.mock("@/server/services/sse-registry", () => ({
  sseRegistry: { broadcast: vi.fn() },
}));

vi.mock("@/app/api/_lib/ip-rate-limit", () => ({
  checkTokenRateLimit: vi.fn().mockReturnValue(null),
}));

// ── Imports (after mocks) ──

import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/server/services/agent-auth";
import { evaluateAlerts } from "@/server/services/alert-evaluator";
import { checkNodeHealth } from "@/server/services/fleet-health";
import { batchUpsertPipelineStatuses } from "@/server/services/heartbeat-batch";
import { ingestMetrics } from "@/server/services/metrics-ingest";
import { ingestLogs } from "@/server/services/log-ingest";
import { POST } from "../route";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const authenticateAgentMock = authenticateAgent as ReturnType<typeof vi.fn>;
const evaluateAlertsMock = evaluateAlerts as ReturnType<typeof vi.fn>;
const checkNodeHealthMock = checkNodeHealth as ReturnType<typeof vi.fn>;
const batchUpsertMock = batchUpsertPipelineStatuses as ReturnType<typeof vi.fn>;
const ingestMetricsMock = ingestMetrics as ReturnType<typeof vi.fn>;
const ingestLogsMock = ingestLogs as ReturnType<typeof vi.fn>;

// ── Helpers ──

function makeRequest(overrides: Record<string, unknown> = {}) {
  const body = {
    agentVersion: "1.0.0",
    pipelines: [
      {
        pipelineId: "pipe-1",
        version: 1,
        status: "RUNNING",
        eventsIn: 100,
        eventsOut: 90,
        bytesIn: 5000,
        bytesOut: 4500,
        componentMetrics: [
          {
            componentId: "src-1",
            componentKind: "source",
            receivedEvents: 100,
            sentEvents: 90,
            latencyMeanSeconds: 0.05,
          },
        ],
      },
    ],
    sampleResults: [
      { requestId: "sample-1", componentKey: "src-1", events: [{ foo: 1 }] },
    ],
    ...overrides,
  };

  return new Request("http://localhost:3000/api/agent/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupBaseMocks() {
  authenticateAgentMock.mockResolvedValue({
    nodeId: "node-1",
    environmentId: "env-1",
  });

  // Pipeline ownership validation
  prismaMock.pipeline.findMany.mockResolvedValue([
    { id: "pipe-1", name: "Test Pipeline" } as never,
  ]);

  // Node status check (already HEALTHY — no transition event)
  prismaMock.vectorNode.findUnique.mockResolvedValue({
    status: "HEALTHY",
  } as never);

  // Node update
  prismaMock.vectorNode.update.mockResolvedValue({
    id: "node-1",
  } as never);

  // Previous snapshots
  prismaMock.nodePipelineStatus.findMany.mockResolvedValue([]);

  // Batch upsert
  batchUpsertMock.mockResolvedValue(undefined);

  // Pipeline status cleanup
  prismaMock.nodePipelineStatus.deleteMany.mockResolvedValue({ count: 0 });

  // Node metrics insert (already fire-and-forget)
  prismaMock.nodeMetric.create.mockResolvedValue({} as never);

  // Event sample request cleanup (fire-and-forget, hourly)
  prismaMock.eventSampleRequest.updateMany.mockResolvedValue({ count: 0 } as never);
  prismaMock.eventSampleRequest.deleteMany.mockResolvedValue({ count: 0 } as never);

  // checkNodeHealth (already fire-and-forget)
  checkNodeHealthMock.mockResolvedValue(undefined);

  // evaluateAlerts defaults to returning empty alerts array
  evaluateAlertsMock.mockResolvedValue([]);
}

// ── Tests ──

describe("heartbeat async decomposition", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
    setupBaseMocks();
  });

  // PERF-01: Heartbeat no longer triggers per-request alert evaluation
  it("returns 200 and does NOT call evaluateAlerts (PERF-01)", async () => {
    // Sample processing — make findUnique for sample request never resolve too
    prismaMock.eventSampleRequest.findUnique.mockReturnValue(
      new Promise(() => {}) as never,
    );

    // Component latency transaction — never resolves
    prismaMock.$transaction.mockReturnValue(new Promise(() => {}));

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    // Proves evaluateAlerts is NOT called from heartbeat (PERF-01)
    expect(evaluateAlertsMock).not.toHaveBeenCalled();
  });

  it("returns 200 while sample processing is still pending (fire-and-forget)", async () => {
    // Alert eval resolves immediately with no alerts
    evaluateAlertsMock.mockResolvedValue([]);

    // Sample processing — findUnique returns a forever-pending promise
    prismaMock.eventSampleRequest.findUnique.mockReturnValue(
      new Promise(() => {}) as never,
    );

    // Component latency transaction — resolves immediately
    prismaMock.$transaction.mockResolvedValue([]);

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    // Proves sample processing was started (findUnique was called for the sample request)
    expect(prismaMock.eventSampleRequest.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sample-1" },
      }),
    );
  });

  it("returns 200 while component latency $transaction is still pending (fire-and-forget)", async () => {
    // Alert eval resolves immediately
    evaluateAlertsMock.mockResolvedValue([]);

    // No sample results to process
    const req = makeRequest({ sampleResults: null });

    // Component latency transaction — never resolves
    prismaMock.$transaction.mockReturnValue(new Promise(() => {}));

    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    // Proves $transaction was called (for the component latency upsert)
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it("returns 200 even when fire-and-forget operations reject", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // Fire-and-forget operations reject
    prismaMock.eventSampleRequest.findUnique.mockRejectedValue(
      new Error("sample boom") as never,
    );
    prismaMock.$transaction.mockRejectedValue(new Error("tx boom"));

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    // Flush microtasks so .catch() handlers run
    await new Promise((r) => setTimeout(r, 10));

    // Verify errors are logged, not swallowed
    // errorLog calls console.error("%s [%s] %s", ts, tag, message, data)
    // so the message is at index 3
    const errorMessages = consoleErrorSpy.mock.calls.map((c) => c[3] ?? c[0]);
    expect(errorMessages).toContain("Sample processing error");
    expect(errorMessages).toContain("Per-component latency upsert error");

    consoleErrorSpy.mockRestore();
  });

  it("returns 200 while ingestMetrics is still pending (fire-and-forget)", async () => {
    // Alert eval + sample processing resolve immediately
    evaluateAlertsMock.mockResolvedValue([]);
    prismaMock.eventSampleRequest.findUnique.mockResolvedValue(null as never);
    prismaMock.$transaction.mockResolvedValue([]);

    // ingestMetrics returns a forever-pending promise
    ingestMetricsMock.mockReturnValue(new Promise(() => {}));

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    // Proves ingestMetrics was invoked (but not awaited)
    expect(ingestMetricsMock).toHaveBeenCalled();
  });

  it("returns 200 while nodeMetric.create is still pending (fire-and-forget)", async () => {
    // All fire-and-forget ops resolve immediately except nodeMetric.create
    evaluateAlertsMock.mockResolvedValue([]);
    prismaMock.eventSampleRequest.findUnique.mockResolvedValue(null as never);
    prismaMock.$transaction.mockResolvedValue([]);

    // nodeMetric.create returns a promise that never resolves
    prismaMock.nodeMetric.create.mockReturnValue({
      catch: vi.fn().mockReturnValue(new Promise(() => {})),
    } as never);

    const req = makeRequest({
      hostMetrics: {
        memoryTotalBytes: 1000,
        memoryUsedBytes: 500,
        cpuSecondsTotal: 100,
      },
    });

    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("returns 200 while checkNodeHealth is still pending (fire-and-forget)", async () => {
    // All fire-and-forget ops resolve immediately except checkNodeHealth
    evaluateAlertsMock.mockResolvedValue([]);
    prismaMock.eventSampleRequest.findUnique.mockResolvedValue(null as never);
    prismaMock.$transaction.mockResolvedValue([]);

    // checkNodeHealth returns a forever-pending promise
    checkNodeHealthMock.mockReturnValue(new Promise(() => {}));

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    // Proves checkNodeHealth was invoked (but not awaited)
    expect(checkNodeHealthMock).toHaveBeenCalled();
  });

  it("returns 200 while ingestLogs is still pending (fire-and-forget)", async () => {
    // All fire-and-forget ops resolve immediately except ingestLogs
    evaluateAlertsMock.mockResolvedValue([]);
    prismaMock.eventSampleRequest.findUnique.mockResolvedValue(null as never);
    prismaMock.$transaction.mockResolvedValue([]);

    // ingestLogs returns a forever-pending promise
    ingestLogsMock.mockReturnValue(new Promise(() => {}));

    // Include recentLogs to trigger the ingestLogs path
    const req = makeRequest({
      pipelines: [
        {
          pipelineId: "pipe-1",
          version: 1,
          status: "RUNNING",
          eventsIn: 100,
          eventsOut: 90,
          recentLogs: ["line 1", "line 2"],
          componentMetrics: [
            {
              componentId: "src-1",
              componentKind: "source",
              receivedEvents: 100,
              sentEvents: 90,
              latencyMeanSeconds: 0.05,
            },
          ],
        },
      ],
    });

    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    // Proves ingestLogs was invoked (but not awaited)
    expect(ingestLogsMock).toHaveBeenCalledWith(
      "node-1",
      "pipe-1",
      "env-1",
      ["line 1", "line 2"],
    );
  });

  it("persists configChecksum from heartbeat payload", async () => {
    setupBaseMocks();

    const req = makeRequest({
      pipelines: [
        {
          pipelineId: "pipe-1",
          version: 3,
          status: "RUNNING",
          configChecksum: "abc123def456",
        },
      ],
      sampleResults: [],
    });

    const response = await POST(req);
    expect(response.status).toBe(200);

    // Verify batchUpsert was called with the configChecksum
    expect(batchUpsertMock).toHaveBeenCalledWith(
      expect.any(String), // nodeId
      expect.arrayContaining([
        expect.objectContaining({
          pipelineId: "pipe-1",
          configChecksum: "abc123def456",
        }),
      ]),
      expect.any(Date),
    );
  });
});
