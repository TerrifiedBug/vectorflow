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

vi.mock("@/server/services/push-broadcast", () => ({
  relayPush: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { pipelineObservabilityRouter } from "@/server/routers/pipeline-observability";
import { evaluatePipelineHealth } from "@/server/services/sli-evaluator";
import { batchEvaluatePipelineHealth } from "@/server/services/batch-health";
import { relayPush } from "@/server/services/push-broadcast";

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
    it("creates a sample request and pushes to running agents", async () => {
      const pipeline = { id: "p-1", isDraft: false, deployedAt: new Date() };
      prismaMock.pipeline.findUnique.mockResolvedValue(pipeline as never);
      prismaMock.eventSampleRequest.create.mockResolvedValue({ id: "req-1" } as never);
      prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
        { nodeId: "node-1" },
        { nodeId: "node-2" },
      ] as never);

      const result = await caller.requestSamples({
        pipelineId: "p-1",
        componentKeys: ["source_1"],
        limit: 5,
      });

      expect(result).toEqual({ requestId: "req-1", status: "PENDING" });
      expect(relayPush).toHaveBeenCalledTimes(2);
      expect(relayPush).toHaveBeenCalledWith(
        "node-1",
        expect.objectContaining({ type: "sample_request", requestId: "req-1" }),
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
});
