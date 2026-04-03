import { vi, describe, it, expect, beforeEach } from "vitest";

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
    middleware: t.middleware,
  };
});

vi.mock("@/server/middleware/audit", () => ({
  withAudit: () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx })),
}));

vi.mock("@/generated/prisma", () => ({
  LogLevel: {
    TRACE: "TRACE",
    DEBUG: "DEBUG",
    INFO: "INFO",
    WARN: "WARN",
    ERROR: "ERROR",
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pipelineMetric: { findMany: vi.fn() },
    pipelineLog: { findMany: vi.fn() },
    pipeline: { findUnique: vi.fn() },
    eventSampleRequest: { create: vi.fn(), findUnique: vi.fn() },
    eventSample: { findMany: vi.fn() },
    nodePipelineStatus: { findMany: vi.fn() },
    pipelineSli: { findMany: vi.fn(), upsert: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock("@/server/services/sli-evaluator", () => ({
  evaluatePipelineHealth: vi.fn(),
}));

vi.mock("@/server/services/batch-health", () => ({
  batchEvaluatePipelineHealth: vi.fn(),
}));

vi.mock("@/server/services/push-broadcast", () => ({
  relayPush: vi.fn(() => true),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "mock-request-id"),
}));

import { relayPush } from "@/server/services/push-broadcast";
import {
  activeTaps,
  startTapHandler,
  stopTapHandler,
  cleanupStaleTaps,
} from "@/server/routers/pipeline-observability";

const TAP_TTL_MS = 5 * 60 * 1000;

describe("tap handler functions", () => {
  beforeEach(() => {
    activeTaps.clear();
    vi.clearAllMocks();
  });

  // ── startTapHandler ────────────────────────────────────────────────────────

  describe("startTapHandler", () => {
    it("registers a tap and sends tap_start push", () => {
      const requestId = startTapHandler("node-1", "pipeline-1", "source_1");

      expect(requestId).toBe("mock-request-id");
      expect(activeTaps.has("mock-request-id")).toBe(true);
      expect(activeTaps.get("mock-request-id")).toEqual(
        expect.objectContaining({
          nodeId: "node-1",
          pipelineId: "pipeline-1",
          componentId: "source_1",
        }),
      );
      expect(relayPush).toHaveBeenCalledWith("node-1", {
        type: "tap_start",
        requestId: "mock-request-id",
        pipelineId: "pipeline-1",
        componentId: "source_1",
      });
    });
  });

  // ── stopTapHandler ─────────────────────────────────────────────────────────

  describe("stopTapHandler", () => {
    it("sends tap_stop and removes from tracking", () => {
      // Pre-populate an active tap
      activeTaps.set("req-1", {
        nodeId: "node-1",
        pipelineId: "pipeline-1",
        componentId: "source_1",
        startedAt: Date.now(),
      });

      stopTapHandler("req-1");

      expect(activeTaps.has("req-1")).toBe(false);
      expect(relayPush).toHaveBeenCalledWith("node-1", {
        type: "tap_stop",
        requestId: "req-1",
      });
    });

    it("no-ops for unknown requestId", () => {
      stopTapHandler("unknown-id");

      expect(relayPush).not.toHaveBeenCalled();
    });
  });

  // ── cleanupStaleTaps ───────────────────────────────────────────────────────

  describe("cleanupStaleTaps", () => {
    it("removes taps older than 5 minutes", () => {
      const staleTime = Date.now() - TAP_TTL_MS - 1000;
      activeTaps.set("stale-1", {
        nodeId: "node-1",
        pipelineId: "pipeline-1",
        componentId: "source_1",
        startedAt: staleTime,
      });

      cleanupStaleTaps();

      expect(activeTaps.has("stale-1")).toBe(false);
      expect(relayPush).toHaveBeenCalledWith("node-1", {
        type: "tap_stop",
        requestId: "stale-1",
      });
    });

    it("keeps taps newer than 5 minutes", () => {
      const freshTime = Date.now() - 1000;
      activeTaps.set("fresh-1", {
        nodeId: "node-1",
        pipelineId: "pipeline-1",
        componentId: "source_1",
        startedAt: freshTime,
      });

      cleanupStaleTaps();

      expect(activeTaps.has("fresh-1")).toBe(true);
      expect(relayPush).not.toHaveBeenCalled();
    });
  });
});
