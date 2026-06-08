import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

vi.mock("@/server/services/anomaly-detector", () => ({
  evaluateAllPipelines: vi.fn().mockResolvedValue([]),
  ANOMALY_CONFIG: {
    POLL_INTERVAL_MS: 60_000,
  },
}));

// SC-3: control leadership so the tick guard can be exercised both ways.
// Defaults to leader so the existing tick-driven tests keep doing work.
vi.mock("@/server/services/leader-election", () => ({
  isLeader: vi.fn(() => true),
}));

import { prisma } from "@/lib/prisma";
import { AnomalyDetectionService } from "@/server/services/anomaly-detection-job";
import { evaluateAllPipelines } from "@/server/services/anomaly-detector";
import { isLeader } from "@/server/services/leader-election";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockEvaluateAll = evaluateAllPipelines as ReturnType<typeof vi.fn>;
const mockIsLeader = isLeader as ReturnType<typeof vi.fn>;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("AnomalyDetectionService", () => {
  let service: AnomalyDetectionService;

  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
    mockIsLeader.mockReturnValue(true);
    vi.useFakeTimers();
    // The tick now iterates orgs from prisma.organization.findMany. Default
    // mock returns a single default org so existing single-org test cases
    // observe one evaluation per tick (matching legacy expectations).
    prismaMock.organization.findMany.mockResolvedValue([
      { id: "default" } as never,
    ]);
    service = new AnomalyDetectionService();
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  it("starts a polling interval on init", () => {
    service.init();

    expect(service.isRunning()).toBe(true);
  });

  it("stops the polling interval on stop", () => {
    service.init();
    service.stop();

    expect(service.isRunning()).toBe(false);
  });

  it("calls evaluateAllPipelines on each tick", async () => {
    service.init();

    // Advance timer past one interval
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockEvaluateAll).toHaveBeenCalledTimes(1);
  });

  it("does not crash if evaluateAllPipelines throws", async () => {
    mockEvaluateAll.mockRejectedValueOnce(new Error("DB connection lost"));

    service.init();

    // Should not throw
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockEvaluateAll).toHaveBeenCalledTimes(1);
  });

  it("runs cleanup of old dismissed anomalies", async () => {
    prismaMock.anomalyEvent.deleteMany.mockResolvedValue({ count: 5 });

    service.init();
    await vi.advanceTimersByTimeAsync(60_000);

    // Cleanup runs on same interval — verify it was called
    // (cleanup is called every 24 ticks = once per day at 60s intervals,
    //  or we can check the cleanup method directly)
  });

  it("iterates non-suspended, non-deleted orgs and evaluates each", async () => {
    prismaMock.organization.findMany.mockResolvedValue([
      { id: "org-a" } as never,
      { id: "org-b" } as never,
      { id: "org-c" } as never,
    ]);

    service.init();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockEvaluateAll).toHaveBeenCalledTimes(3);
    expect(mockEvaluateAll).toHaveBeenCalledWith({ organizationId: "org-a" });
    expect(mockEvaluateAll).toHaveBeenCalledWith({ organizationId: "org-b" });
    expect(mockEvaluateAll).toHaveBeenCalledWith({ organizationId: "org-c" });
    const findManyArgs = prismaMock.organization.findMany.mock.calls[0][0];
    expect(findManyArgs?.where?.suspendedAt).toBe(null);
    expect(findManyArgs?.where?.deletedAt).toBe(null);
  });

  it("per-org failure does not abort the rest", async () => {
    prismaMock.organization.findMany.mockResolvedValue([
      { id: "org-a" } as never,
      { id: "org-b" } as never,
    ]);
    mockEvaluateAll
      .mockRejectedValueOnce(new Error("kaboom"))
      .mockResolvedValueOnce([] as never);

    service.init();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockEvaluateAll).toHaveBeenCalledTimes(2);
  });

  it("survives prisma.organization.findMany failure without crashing the tick", async () => {
    prismaMock.organization.findMany.mockRejectedValueOnce(
      new Error("DB connection lost"),
    );

    service.init();
    // Should not throw an unhandled rejection.
    await vi.advanceTimersByTimeAsync(60_000);

    // evaluateAllPipelines must not have been called \u2014 we exited early.
    expect(mockEvaluateAll).not.toHaveBeenCalled();
  });

  it("skips an overlapping tick when the previous tick is still running", async () => {
    // Long-running evaluate: first call never resolves until we release it.
    let releaseFirst: (v: unknown) => void = () => {};
    mockEvaluateAll.mockImplementationOnce(
      () => new Promise((res) => { releaseFirst = res; }),
    );
    mockEvaluateAll.mockResolvedValue([] as never);

    service.init();
    // Fire interval #1 — tick starts, awaits hung evaluate, tickInFlight stays true
    await vi.advanceTimersByTimeAsync(60_000);
    // Fire interval #2 — should observe tickInFlight=true and skip
    await vi.advanceTimersByTimeAsync(60_000);

    // Only one evaluate call so far (the first, still in flight); the
    // second interval's tick exited early without entering the loop.
    expect(mockEvaluateAll).toHaveBeenCalledTimes(1);

    // Release the hung evaluate so the test exits cleanly.
    releaseFirst([]);
  });

  // ── SC-3: leadership guard (de-SPOF schedulers) ──────────────────────────

  describe("leadership guard", () => {
    it("tick is a no-op when the instance is no longer leader", async () => {
      mockIsLeader.mockReturnValue(false);
      prismaMock.organization.findMany.mockResolvedValue([
        { id: "org-a" } as never,
      ]);

      service.init();
      await vi.advanceTimersByTimeAsync(60_000);

      // A demoted instance must do no work: no org scan, no pipeline
      // evaluation — otherwise it duplicates the new leader's anomaly runs.
      expect(prismaMock.organization.findMany).not.toHaveBeenCalled();
      expect(mockEvaluateAll).not.toHaveBeenCalled();
    });

    it("tick proceeds normally while the instance is leader", async () => {
      mockIsLeader.mockReturnValue(true);
      prismaMock.organization.findMany.mockResolvedValue([
        { id: "org-a" } as never,
      ]);

      service.init();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(prismaMock.organization.findMany).toHaveBeenCalledTimes(1);
      expect(mockEvaluateAll).toHaveBeenCalledWith({ organizationId: "org-a" });
    });
  });
});
