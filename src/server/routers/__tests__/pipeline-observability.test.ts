import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { t } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return { t };
});

vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx }));
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    withTeamAccess: passthrough,
    requireSuperAdmin: passthrough,
    denyInDemo: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/server/middleware/audit", () => ({
  withAudit: () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/sli-evaluator", () => ({
  evaluatePipelineHealth: vi.fn(),
}));

vi.mock("@/server/services/batch-health", () => ({
  batchEvaluatePipelineHealth: vi.fn(),
}));

vi.mock("@/server/services/cost-attribution", () => ({
  getPipelineCostSnapshot: vi.fn(),
  computeCostCents: vi.fn((bytes: number, costPerGb: number) =>
    bytes === 0 || costPerGb === 0
      ? 0
      : Math.round((bytes / 1_073_741_824) * costPerGb),
  ),
}));

vi.mock("@/server/services/push-broadcast", () => ({
  relayPush: vi.fn(() => true),
  deliverPush: vi.fn(() => "local"),
  tryLocalPush: vi.fn(() => true),
}));

vi.mock("@/server/services/push-registry", () => ({
  pushRegistry: {
    isConnected: vi.fn(() => true),
  },
}));

import { prisma } from "@/lib/prisma";
import { pipelineObservabilityRouter } from "@/server/routers/pipeline-observability";
import { evaluatePipelineHealth } from "@/server/services/sli-evaluator";
import { batchEvaluatePipelineHealth } from "@/server/services/batch-health";
import { getPipelineCostSnapshot } from "@/server/services/cost-attribution";
import { relayPush, tryLocalPush } from "@/server/services/push-broadcast";
import { pushRegistry } from "@/server/services/push-registry";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(pipelineObservabilityRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

describe("pipelineObservabilityRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ── metrics ───────────────────────────────────────────────────────────────

  describe("metrics", () => {
    it("returns pipeline metrics for the given time window", async () => {
      const metrics = [
        {
          timestamp: new Date(),
          eventsIn: 100,
          eventsOut: 95,
          eventsDiscarded: 5,
          errorsTotal: 0,
          bytesIn: 1000,
          bytesOut: 950,
          utilization: 0.5,
          latencyMeanMs: 12.5,
        },
      ];
      prismaMock.pipelineMetric.findMany.mockResolvedValue(metrics as never);

      const result = await caller.metrics({ pipelineId: "p-1", hours: 24 });

      expect(result).toEqual(metrics);
      expect(prismaMock.pipelineMetric.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            pipelineId: "p-1",
            nodeId: null,
            componentId: null,
          }),
          orderBy: { timestamp: "asc" },
        }),
      );
    });
  });

  // ── logs ──────────────────────────────────────────────────────────────────

  describe("logs", () => {
    it("returns logs with pagination", async () => {
      const logs = Array.from({ length: 3 }, (_, i) => ({
        id: `log-${i}`,
        pipelineId: "p-1",
        level: "INFO",
        message: `Log message ${i}`,
        timestamp: new Date(),
        node: { name: "source-1" },
        pipeline: { name: "Test Pipeline" },
      }));
      prismaMock.pipelineLog.findMany.mockResolvedValue(logs as never);

      const result = await caller.logs({ pipelineId: "p-1", limit: 10 });

      expect(result.items).toEqual(logs);
      expect(result.nextCursor).toBeUndefined();
    });

    it("returns nextCursor when more items exist", async () => {
      // Return limit + 1 items to signal there are more pages
      const logs = Array.from({ length: 4 }, (_, i) => ({
        id: `log-${i}`,
        pipelineId: "p-1",
        level: "INFO",
        message: `Log message ${i}`,
        timestamp: new Date(),
        node: { name: "source-1" },
        pipeline: { name: "Test Pipeline" },
      }));
      prismaMock.pipelineLog.findMany.mockResolvedValue(logs as never);

      const result = await caller.logs({ pipelineId: "p-1", limit: 3 });

      expect(result.items).toHaveLength(3);
      expect(result.nextCursor).toBe("log-3");
    });

    it("uses cursor for pagination", async () => {
      prismaMock.pipelineLog.findMany.mockResolvedValue([] as never);

      await caller.logs({ pipelineId: "p-1", limit: 10, cursor: "cursor-id" });

      expect(prismaMock.pipelineLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: "cursor-id" },
          skip: 1,
        }),
      );
    });
  });

  // ── requestSamples ────────────────────────────────────────────────────────

  describe("requestSamples", () => {
    it("atomically binds before pushing when a node has a local SSE connection", async () => {
      const pipeline = { id: "p-1", isDraft: false, deployedAt: new Date() };
      prismaMock.pipeline.findUnique.mockResolvedValue(pipeline as never);
      prismaMock.eventSampleRequest.create.mockResolvedValue({ id: "req-1" } as never);
      prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
        { nodeId: "node-1" },
        { nodeId: "node-2" },
      ] as never);
      vi.mocked(pushRegistry.isConnected).mockReturnValue(true);
      prismaMock.eventSampleRequest.updateMany.mockResolvedValue({ count: 1 } as never);
      vi.mocked(tryLocalPush).mockReturnValue(true);

      const result = await caller.requestSamples({
        pipelineId: "p-1",
        componentKeys: ["source_1"],
        limit: 5,
      });

      expect(result).toEqual({ requestId: "req-1", status: "PENDING" });
      // Binding is written via conditional updateMany (status=PENDING, nodeId=null)
      // BEFORE the push is sent.
      expect(prismaMock.eventSampleRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "req-1", status: "PENDING", nodeId: null },
          data: { nodeId: "node-1" },
        }),
      );
      // No Redis fan-out when local delivery succeeded.
      expect(relayPush).not.toHaveBeenCalled();
    });

    it("returns PENDING without overwriting when another node has already claimed", async () => {
      const pipeline = { id: "p-1", isDraft: false, deployedAt: new Date() };
      prismaMock.pipeline.findUnique.mockResolvedValue(pipeline as never);
      prismaMock.eventSampleRequest.create.mockResolvedValue({ id: "req-race" } as never);
      prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
        { nodeId: "node-1" },
      ] as never);
      vi.mocked(pushRegistry.isConnected).mockReturnValue(true);
      // Conditional update finds nothing — another agent claimed in between.
      prismaMock.eventSampleRequest.updateMany.mockResolvedValue({ count: 0 } as never);

      const result = await caller.requestSamples({
        pipelineId: "p-1",
        componentKeys: ["source_1"],
        limit: 5,
      });

      expect(result).toEqual({ requestId: "req-race", status: "PENDING" });
      // No SSE push attempted — we lost the race and the other claimant owns it.
      expect(tryLocalPush).not.toHaveBeenCalled();
      expect(relayPush).not.toHaveBeenCalled();
    });

    it("falls through to the next node when the first has no local connection", async () => {
      const pipeline = { id: "p-1", isDraft: false, deployedAt: new Date() };
      prismaMock.pipeline.findUnique.mockResolvedValue(pipeline as never);
      prismaMock.eventSampleRequest.create.mockResolvedValue({ id: "req-2" } as never);
      prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
        { nodeId: "node-1" },
        { nodeId: "node-2" },
      ] as never);
      vi.mocked(pushRegistry.isConnected)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);
      prismaMock.eventSampleRequest.updateMany.mockResolvedValue({ count: 1 } as never);
      vi.mocked(tryLocalPush).mockReturnValue(true);

      const result = await caller.requestSamples({
        pipelineId: "p-1",
        componentKeys: ["source_1"],
        limit: 5,
      });

      expect(result).toEqual({ requestId: "req-2", status: "PENDING" });
      expect(prismaMock.eventSampleRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "req-2", status: "PENDING", nodeId: null },
          data: { nodeId: "node-2" },
        }),
      );
    });

    it("fans out via Redis and leaves nodeId null when no local delivery is possible", async () => {
      const pipeline = { id: "p-1", isDraft: false, deployedAt: new Date() };
      prismaMock.pipeline.findUnique.mockResolvedValue(pipeline as never);
      prismaMock.eventSampleRequest.create.mockResolvedValue({ id: "req-fanout" } as never);
      prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
        { nodeId: "node-1" },
        { nodeId: "node-2" },
      ] as never);
      // No node has a local SSE connection — fan-out via Redis
      vi.mocked(pushRegistry.isConnected).mockReturnValue(false);
      vi.mocked(relayPush).mockReturnValue(true);

      const result = await caller.requestSamples({
        pipelineId: "p-1",
        componentKeys: ["source_1"],
        limit: 5,
      });

      expect(result).toEqual({ requestId: "req-fanout", status: "PENDING" });
      // No bind attempted — no local connection means we never try to claim.
      expect(prismaMock.eventSampleRequest.updateMany).not.toHaveBeenCalled();
      // Redis broadcast went to BOTH running nodes
      expect(relayPush).toHaveBeenCalledTimes(2);
    });

    it("deletes the request and throws when no nodes are reachable at all", async () => {
      const pipeline = { id: "p-1", isDraft: false, deployedAt: new Date() };
      prismaMock.pipeline.findUnique.mockResolvedValue(pipeline as never);
      prismaMock.eventSampleRequest.create.mockResolvedValue({ id: "req-3" } as never);
      prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
        { nodeId: "node-1" },
      ] as never);
      vi.mocked(pushRegistry.isConnected).mockReturnValue(false);
      vi.mocked(relayPush).mockReturnValue(false);

      await expect(
        caller.requestSamples({
          pipelineId: "p-1",
          componentKeys: ["source_1"],
          limit: 5,
        }),
      ).rejects.toThrow(/No reachable nodes/);
      expect(prismaMock.eventSampleRequest.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "req-3" } }),
      );
    });

    it("throws NOT_FOUND when pipeline does not exist", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(null as never);

      await expect(
        caller.requestSamples({ pipelineId: "missing", componentKeys: ["src_1"], limit: 5 }),
      ).rejects.toThrow("Pipeline not found");
    });

    it("throws PRECONDITION_FAILED when pipeline is a draft", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue({
        id: "p-1",
        isDraft: true,
        deployedAt: null,
      } as never);

      await expect(
        caller.requestSamples({ pipelineId: "p-1", componentKeys: ["src_1"], limit: 5 }),
      ).rejects.toThrow("Pipeline must be deployed to sample events");
    });
  });

  // ── sampleResult ──────────────────────────────────────────────────────────

  describe("sampleResult", () => {
    it("returns the sample result with samples", async () => {
      const request = {
        id: "req-1",
        status: "COMPLETED",
        samples: [
          {
            id: "sample-1",
            componentKey: "source_1",
            events: [{ data: "test" }],
            schema: { type: "object" },
            error: null,
            sampledAt: new Date(),
          },
        ],
      };
      prismaMock.eventSampleRequest.findUnique.mockResolvedValue(request as never);

      const result = await caller.sampleResult({ requestId: "req-1" });

      expect(result.requestId).toBe("req-1");
      expect(result.status).toBe("COMPLETED");
      expect(result.samples).toHaveLength(1);
    });

    it("throws NOT_FOUND when sample request does not exist", async () => {
      prismaMock.eventSampleRequest.findUnique.mockResolvedValue(null as never);

      await expect(caller.sampleResult({ requestId: "missing" })).rejects.toThrow("Sample request not found");
    });
  });

  // ── eventSchemas ──────────────────────────────────────────────────────────

  describe("eventSchemas", () => {
    it("returns deduplicated event schemas per component key", async () => {
      const samples = [
        { componentKey: "source_1", schema: { type: "object" }, events: [], sampledAt: new Date("2025-01-02") },
        { componentKey: "source_1", schema: { type: "string" }, events: [], sampledAt: new Date("2025-01-01") },
        { componentKey: "source_2", schema: { type: "array" }, events: [], sampledAt: new Date("2025-01-02") },
      ];
      prismaMock.eventSample.findMany.mockResolvedValue(samples as never);

      const result = await caller.eventSchemas({ pipelineId: "p-1" });

      expect(result).toHaveLength(2);
      expect(result[0].componentKey).toBe("source_1");
      expect(result[1].componentKey).toBe("source_2");
    });
  });

  // ── listSlis ──────────────────────────────────────────────────────────────

  describe("listSlis", () => {
    it("returns all SLIs for a pipeline", async () => {
      const slis = [
        { id: "sli-1", pipelineId: "p-1", metric: "error_rate", condition: "gt", threshold: 5 },
      ];
      prismaMock.pipelineSli.findMany.mockResolvedValue(slis as never);

      const result = await caller.listSlis({ pipelineId: "p-1" });

      expect(result).toEqual(slis);
      expect(prismaMock.pipelineSli.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { pipelineId: "p-1" },
          orderBy: { createdAt: "asc" },
        }),
      );
    });
  });

  // ── upsertSli ─────────────────────────────────────────────────────────────

  describe("upsertSli", () => {
    it("upserts an SLI definition", async () => {
      const sli = {
        id: "sli-1",
        pipelineId: "p-1",
        metric: "error_rate",
        condition: "gt",
        threshold: 5,
        windowMinutes: 5,
      };
      prismaMock.pipelineSli.upsert.mockResolvedValue(sli as never);

      const result = await caller.upsertSli({
        pipelineId: "p-1",
        metric: "error_rate",
        condition: "gt",
        threshold: 5,
        windowMinutes: 5,
      });

      expect(result).toEqual(sli);
      expect(prismaMock.pipelineSli.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            pipelineId_metric: {
              pipelineId: "p-1",
              metric: "error_rate",
            },
          },
          create: expect.objectContaining({
            pipelineId: "p-1",
            metric: "error_rate",
            condition: "gt",
            threshold: 5,
          }),
          update: expect.objectContaining({
            condition: "gt",
            threshold: 5,
          }),
        }),
      );
    });
  });

  // ── deleteSli ─────────────────────────────────────────────────────────────

  describe("deleteSli", () => {
    it("deletes an SLI", async () => {
      prismaMock.pipelineSli.findUnique.mockResolvedValue({
        id: "sli-1",
        pipelineId: "p-1",
      } as never);
      const deleted = { id: "sli-1", pipelineId: "p-1" };
      prismaMock.pipelineSli.delete.mockResolvedValue(deleted as never);

      const result = await caller.deleteSli({ id: "sli-1", pipelineId: "p-1" });

      expect(result).toEqual(deleted);
      expect(prismaMock.pipelineSli.delete).toHaveBeenCalledWith({ where: { id: "sli-1" } });
    });

    it("throws NOT_FOUND when SLI does not exist", async () => {
      prismaMock.pipelineSli.findUnique.mockResolvedValue(null as never);

      await expect(caller.deleteSli({ id: "missing", pipelineId: "p-1" })).rejects.toThrow("SLI not found");
    });

    it("throws NOT_FOUND when SLI belongs to a different pipeline", async () => {
      prismaMock.pipelineSli.findUnique.mockResolvedValue({
        id: "sli-1",
        pipelineId: "p-other",
      } as never);

      await expect(caller.deleteSli({ id: "sli-1", pipelineId: "p-1" })).rejects.toThrow("SLI not found");
    });
  });

  // ── health ────────────────────────────────────────────────────────────────

  describe("health", () => {
    it("delegates to evaluatePipelineHealth", async () => {
      const healthResult = { status: "healthy", score: 100, indicators: [] };
      vi.mocked(evaluatePipelineHealth).mockResolvedValue(healthResult as never);

      const result = await caller.health({ pipelineId: "p-1" });

      expect(result).toEqual(healthResult);
      expect(evaluatePipelineHealth).toHaveBeenCalledWith("p-1");
    });
  });

  // ── batchHealth ───────────────────────────────────────────────────────────

  describe("batchHealth", () => {
    it("delegates to batchEvaluatePipelineHealth", async () => {
      const batchResult = {
        "p-1": { status: "healthy", score: 100 },
        "p-2": { status: "degraded", score: 60 },
      };
      vi.mocked(batchEvaluatePipelineHealth).mockResolvedValue(batchResult as never);

      const result = await caller.batchHealth({ pipelineIds: ["p-1", "p-2"] });

      expect(result).toEqual(batchResult);
      expect(batchEvaluatePipelineHealth).toHaveBeenCalledWith(["p-1", "p-2"]);
    });
  });

  // ── scorecard ─────────────────────────────────────────────────────────────

  describe("scorecard", () => {
    function setupHappyPathMocks(overrides: {
      health?: unknown;
      firingAlerts?: number;
      openAnomalyCount?: number;
      anomalySeverities?: Array<{ severity: string }>;
      last24h?: unknown;
      prior24hAgg?: unknown;
      current24hAgg?: unknown;
      sevenDayAgg?: unknown;
      recommendations?: unknown[];
    } = {}) {
      prismaMock.pipeline.findUnique.mockResolvedValue({
        id: "p-1",
        name: "Test Pipeline",
        isDraft: false,
        deployedAt: new Date("2026-05-01T00:00:00Z"),
        environmentId: "env-1",
        environment: { costPerGbCents: 50 },
      } as never);

      vi.mocked(evaluatePipelineHealth).mockResolvedValue(
        (overrides.health ?? { status: "healthy", slis: [] }) as never,
      );

      vi.mocked(getPipelineCostSnapshot).mockResolvedValue(
        (overrides.last24h ?? {
          bytesIn: 2_000_000_000,
          bytesOut: 1_000_000_000,
          reductionPercent: 50,
          costCents: 100,
          periodHours: 24,
        }) as never,
      );

      prismaMock.alertEvent.count.mockResolvedValue(
        (overrides.firingAlerts ?? 0) as never,
      );
      prismaMock.anomalyEvent.count.mockResolvedValue(
        (overrides.openAnomalyCount ?? 0) as never,
      );
      prismaMock.anomalyEvent.findMany.mockResolvedValue(
        (overrides.anomalySeverities ?? []) as never,
      );

      prismaMock.pipelineMetric.aggregate
        .mockResolvedValueOnce(
          (overrides.prior24hAgg ?? {
            _sum: { bytesIn: 1_000_000_000, bytesOut: 500_000_000 },
          }) as never,
        )
        .mockResolvedValueOnce(
          (overrides.current24hAgg ?? {
            _sum: { eventsIn: 10_000, errorsTotal: 50 },
          }) as never,
        )
        .mockResolvedValueOnce(
          (overrides.sevenDayAgg ?? {
            _sum: { eventsIn: 70_000, errorsTotal: 350 },
          }) as never,
        );

      prismaMock.costRecommendation.findMany.mockResolvedValue(
        (overrides.recommendations ?? []) as never,
      );
    }

    it("composes health, alerts, anomalies, cost, trend, and recommendations into one response", async () => {
      setupHappyPathMocks();

      const result = await caller.scorecard({ pipelineId: "p-1" });

      expect(result.pipeline).toEqual({
        id: "p-1",
        name: "Test Pipeline",
        isDraft: false,
        deployedAt: new Date("2026-05-01T00:00:00Z"),
        environmentId: "env-1",
      });
      expect(result.health.status).toBe("healthy");
      expect(result.alerts.firingCount).toBe(0);
      expect(result.anomalies.openCount).toBe(0);
      expect(result.anomalies.maxSeverity).toBeNull();
      expect(result.cost.last24h.bytesIn).toBe(2_000_000_000);
      // prior24h derived from second aggregate call
      expect(result.cost.prior24h.bytesIn).toBe(1_000_000_000);
      // delta = (2_000_000_000 - 1_000_000_000) / 1_000_000_000 = 1.0
      expect(result.cost.deltaPercent).toBeCloseTo(100, 1);
      // current error rate = 50/10000 = 0.005, baseline = 350/70000 = 0.005, ratio = 1
      expect(result.trend.errorRate?.deltaRatio).toBeCloseTo(1, 1);
      expect(result.recommendations).toEqual([]);
      expect(result.recommendedAction).toBeNull();
    });

    it("throws NOT_FOUND when pipeline does not exist", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(null as never);

      await expect(caller.scorecard({ pipelineId: "missing" })).rejects.toThrow(
        "Pipeline not found",
      );
    });

    it("returns null deltaPercent when prior period has no traffic", async () => {
      setupHappyPathMocks({
        prior24hAgg: { _sum: { bytesIn: 0, bytesOut: 0 } },
      });

      const result = await caller.scorecard({ pipelineId: "p-1" });

      expect(result.cost.prior24h.bytesIn).toBe(0);
      expect(result.cost.deltaPercent).toBeNull();
    });

    it("recommends investigating SLI when health is degraded", async () => {
      setupHappyPathMocks({
        health: {
          status: "degraded",
          slis: [
            {
              metric: "error_rate",
              status: "breached",
              value: 0.1,
              threshold: 0.05,
              condition: "lt",
            },
          ],
        },
      });

      const result = await caller.scorecard({ pipelineId: "p-1" });

      expect(result.recommendedAction?.kind).toBe("investigate_sli");
      expect(result.recommendedAction?.message).toContain("error_rate");
    });

    it("picks highest severity from open anomalies", async () => {
      setupHappyPathMocks({
        openAnomalyCount: 3,
        anomalySeverities: [
          { severity: "warning" },
          { severity: "critical" },
          { severity: "info" },
        ],
      });

      const result = await caller.scorecard({ pipelineId: "p-1" });

      expect(result.anomalies.openCount).toBe(3);
      expect(result.anomalies.maxSeverity).toBe("critical");
      // Critical anomaly outranks empty alerts/cost-recs
      expect(result.recommendedAction?.kind).toBe("review_anomaly");
    });

    it("filters metric aggregates to cross-node rollup rows (nodeId: null, componentId: null)", async () => {
      setupHappyPathMocks();

      await caller.scorecard({ pipelineId: "p-1" });

      // Every pipelineMetric.aggregate call must constrain on both nodeId: null
      // AND componentId: null. Without nodeId: null the sum double-counts because
      // ingest writes both per-node rows and a separate aggregated row.
      const aggCalls = prismaMock.pipelineMetric.aggregate.mock.calls;
      expect(aggCalls.length).toBeGreaterThanOrEqual(3);
      for (const [args] of aggCalls) {
        expect(args.where).toMatchObject({
          pipelineId: "p-1",
          nodeId: null,
          componentId: null,
        });
      }
    });

    it("recommends applying cost recommendation when one exists and nothing else fires", async () => {
      setupHappyPathMocks({
        recommendations: [
          {
            id: "rec-1",
            title: "Add filter to drop debug logs",
            type: "ADD_FILTER",
            estimatedSavingsBytes: BigInt(500_000_000),
          },
        ],
      });

      const result = await caller.scorecard({ pipelineId: "p-1" });

      expect(result.recommendations).toHaveLength(1);
      expect(result.recommendedAction?.kind).toBe("apply_cost_recommendation");
    });
  });
});
