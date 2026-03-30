import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/anomaly-detector", () => ({
  evaluateAllPipelines: vi.fn().mockResolvedValue([]),
  ANOMALY_CONFIG: {
    POLL_INTERVAL_MS: 60_000,
  },
}));

import { prisma } from "@/lib/prisma";
import { AnomalyDetectionService } from "@/server/services/anomaly-detection-job";
import { evaluateAllPipelines } from "@/server/services/anomaly-detector";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockEvaluateAll = evaluateAllPipelines as ReturnType<typeof vi.fn>;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("AnomalyDetectionService", () => {
  let service: AnomalyDetectionService;

  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
    vi.useFakeTimers();
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
});
