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
    denyInDemo: passthrough,
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
    activeTap: {
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
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

// Mock the persistent tap store with simple stubs the handler functions consume.
const mockSetActiveTap = vi.fn();
const mockDeleteActiveTap = vi.fn();
const mockExpireStaleTaps = vi.fn();
vi.mock("@/server/services/active-taps", () => ({
  TAP_TTL_MS: 5 * 60 * 1000,
  setActiveTap: (...args: unknown[]) => mockSetActiveTap(...args),
  deleteActiveTap: (...args: unknown[]) => mockDeleteActiveTap(...args),
  expireStaleTaps: (...args: unknown[]) => mockExpireStaleTaps(...args),
  getActiveTap: vi.fn(),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "mock-request-id"),
}));

import { relayPush } from "@/server/services/push-broadcast";
import {
  startTapHandler,
  stopTapHandler,
  cleanupStaleTaps,
} from "@/server/routers/pipeline-observability";

describe("tap handler functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetActiveTap.mockReset();
    mockDeleteActiveTap.mockReset();
    mockExpireStaleTaps.mockReset();
  });

  describe("startTapHandler", () => {
    it("registers a tap and sends tap_start push", async () => {
      mockSetActiveTap.mockResolvedValueOnce(undefined);

      const requestId = await startTapHandler("node-1", "pipeline-1", "source_1");

      expect(requestId).toBe("mock-request-id");
      expect(mockSetActiveTap).toHaveBeenCalledWith("mock-request-id", {
        nodeId: "node-1",
        pipelineId: "pipeline-1",
        componentId: "source_1",
      });
      expect(relayPush).toHaveBeenCalledWith("node-1", {
        type: "tap_start",
        requestId: "mock-request-id",
        pipelineId: "pipeline-1",
        componentId: "source_1",
      });
    });
  });

  describe("stopTapHandler", () => {
    it("sends tap_stop and removes the tap when present", async () => {
      mockDeleteActiveTap.mockResolvedValueOnce({
        nodeId: "node-1",
        pipelineId: "pipeline-1",
        componentId: "source_1",
        startedAt: Date.now(),
      });

      await stopTapHandler("req-1");

      expect(mockDeleteActiveTap).toHaveBeenCalledWith("req-1");
      expect(relayPush).toHaveBeenCalledWith("node-1", {
        type: "tap_stop",
        requestId: "req-1",
      });
    });

    it("no-ops for unknown requestId", async () => {
      mockDeleteActiveTap.mockResolvedValueOnce(null);

      await stopTapHandler("unknown-id");

      expect(relayPush).not.toHaveBeenCalled();
    });
  });

  describe("cleanupStaleTaps", () => {
    it("relays tap_stop for each expired tap returned by the store", async () => {
      mockExpireStaleTaps.mockResolvedValueOnce([
        { requestId: "stale-1", nodeId: "node-1" },
        { requestId: "stale-2", nodeId: "node-2" },
      ]);

      await cleanupStaleTaps();

      expect(relayPush).toHaveBeenCalledTimes(2);
      expect(relayPush).toHaveBeenCalledWith("node-1", {
        type: "tap_stop",
        requestId: "stale-1",
      });
      expect(relayPush).toHaveBeenCalledWith("node-2", {
        type: "tap_stop",
        requestId: "stale-2",
      });
    });

    it("does nothing when the store has no expired taps", async () => {
      mockExpireStaleTaps.mockResolvedValueOnce([]);

      await cleanupStaleTaps();

      expect(relayPush).not.toHaveBeenCalled();
    });
  });
});
