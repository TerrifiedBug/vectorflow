import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/pipeline-version", () => ({
  deployFromVersion: vi.fn(),
}));

vi.mock("@/server/services/event-alerts", () => ({
  fireEventAlert: vi.fn(),
}));

vi.mock("@/server/services/sse-broadcast", () => ({
  broadcastSSE: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import {
  AutoRollbackService,
  getAggregateErrorRate,
} from "@/server/services/auto-rollback";
import { deployFromVersion } from "@/server/services/pipeline-version";
import { fireEventAlert } from "@/server/services/event-alerts";
import { broadcastSSE } from "@/server/services/sse-broadcast";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const deployFromVersionMock = vi.mocked(deployFromVersion);
const fireEventAlertMock = vi.mocked(fireEventAlert);
const broadcastMock = vi.mocked(broadcastSSE);

// ─── Helpers ────────────────────────────────────────────────────────────────

const NOW = new Date("2025-06-01T12:00:00Z");

function makePipelineCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "pipe-1",
    name: "My Pipeline",
    environmentId: "env-1",
    autoRollbackThreshold: 5.0,
    autoRollbackWindowMinutes: 5,
    deployedAt: new Date(NOW.getTime() - 2 * 60 * 1000), // 2 minutes ago
    ...overrides,
  };
}

function makeVersions(
  overrides?: {
    latest?: Record<string, unknown>;
    previous?: Record<string, unknown>;
  },
) {
  return [
    {
      id: "ver-2",
      version: 2,
      createdById: "user-1",
      ...(overrides?.latest ?? {}),
    },
    {
      id: "ver-1",
      version: 1,
      createdById: "user-1",
      ...(overrides?.previous ?? {}),
    },
  ];
}

function makeStatusRows(
  eventsIn: bigint,
  errorsTotal: bigint,
  count = 1,
) {
  return Array.from({ length: count }, () => ({
    eventsIn,
    errorsTotal,
  }));
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("AutoRollbackService", () => {
  let service: AutoRollbackService;

  beforeEach(() => {
    mockReset(prismaMock);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    service = new AutoRollbackService();
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  // 1. Pipeline with error rate above threshold → rollback triggered
  it("triggers rollback when error rate exceeds threshold", async () => {
    const pipeline = makePipelineCandidate();
    prismaMock.pipeline.findMany.mockResolvedValue([pipeline] as never);
    prismaMock.pipelineVersion.findMany.mockResolvedValue(
      makeVersions() as never,
    );
    // 10% error rate (100 errors out of 1000 events)
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue(
      makeStatusRows(BigInt(1000), BigInt(100)) as never,
    );
    deployFromVersionMock.mockResolvedValue({
      version: {} as never,
      pushedNodeIds: [],
    });
    prismaMock.pipeline.update.mockResolvedValue({} as never);
    fireEventAlertMock.mockResolvedValue();

    await service.checkPipelines();

    // deployFromVersion called with previous version
    expect(deployFromVersionMock).toHaveBeenCalledWith(
      "pipe-1",
      "ver-1",
      "user-1",
      expect.stringContaining("Auto-rollback"),
    );

    // autoRollbackEnabled set to false
    expect(prismaMock.pipeline.update).toHaveBeenCalledWith({
      where: { id: "pipe-1" },
      data: { autoRollbackEnabled: false },
    });

    // fireEventAlert called
    expect(fireEventAlertMock).toHaveBeenCalledWith(
      "deploy_completed",
      "env-1",
      expect.objectContaining({
        pipelineId: "pipe-1",
        message: expect.stringContaining("Auto-rollback"),
      }),
    );

    // SSE broadcast called
    expect(broadcastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "pipeline_status",
        pipelineId: "pipe-1",
        action: "auto_rollback",
      }),
      "env-1",
    );
  });

  // 2. Pipeline with error rate below threshold → no rollback
  it("does not rollback when error rate is below threshold", async () => {
    const pipeline = makePipelineCandidate();
    prismaMock.pipeline.findMany.mockResolvedValue([pipeline] as never);
    prismaMock.pipelineVersion.findMany.mockResolvedValue(
      makeVersions() as never,
    );
    // 2% error rate (20 errors out of 1000 events) — below default 5% threshold
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue(
      makeStatusRows(BigInt(1000), BigInt(20)) as never,
    );

    await service.checkPipelines();

    expect(deployFromVersionMock).not.toHaveBeenCalled();
  });

  // 3. Pipeline deployed outside monitoring window → not included
  it("excludes pipelines deployed outside the monitoring window", async () => {
    const pipeline = makePipelineCandidate({
      // Deployed 10 minutes ago, window is 5 minutes
      deployedAt: new Date(NOW.getTime() - 10 * 60 * 1000),
    });
    prismaMock.pipeline.findMany.mockResolvedValue([pipeline] as never);

    await service.checkPipelines();

    // Should not even query versions — candidate was filtered out
    expect(prismaMock.pipelineVersion.findMany).not.toHaveBeenCalled();
    expect(deployFromVersionMock).not.toHaveBeenCalled();
  });

  // 4. Pipeline with no previous version → skipped
  it("skips pipelines with no previous version", async () => {
    const pipeline = makePipelineCandidate();
    prismaMock.pipeline.findMany.mockResolvedValue([pipeline] as never);
    // Only one version — no rollback target
    prismaMock.pipelineVersion.findMany.mockResolvedValue([
      { id: "ver-1", version: 1, createdById: "user-1" },
    ] as never);

    await service.checkPipelines();

    expect(deployFromVersionMock).not.toHaveBeenCalled();
  });

  // 5. After rollback → autoRollbackEnabled set to false
  it("sets autoRollbackEnabled to false after rollback", async () => {
    const pipeline = makePipelineCandidate();
    prismaMock.pipeline.findMany.mockResolvedValue([pipeline] as never);
    prismaMock.pipelineVersion.findMany.mockResolvedValue(
      makeVersions() as never,
    );
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue(
      makeStatusRows(BigInt(1000), BigInt(100)) as never,
    );
    deployFromVersionMock.mockResolvedValue({
      version: {} as never,
      pushedNodeIds: [],
    });
    prismaMock.pipeline.update.mockResolvedValue({} as never);
    fireEventAlertMock.mockResolvedValue();

    await service.checkPipelines();

    expect(prismaMock.pipeline.update).toHaveBeenCalledWith({
      where: { id: "pipe-1" },
      data: { autoRollbackEnabled: false },
    });
  });

  // 6. Zero eventsIn → error rate is 0, no rollback (no divide-by-zero)
  it("returns error rate 0 when eventsIn is 0 (no divide-by-zero)", async () => {
    const pipeline = makePipelineCandidate();
    prismaMock.pipeline.findMany.mockResolvedValue([pipeline] as never);
    prismaMock.pipelineVersion.findMany.mockResolvedValue(
      makeVersions() as never,
    );
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue(
      makeStatusRows(BigInt(0), BigInt(0)) as never,
    );

    await service.checkPipelines();

    expect(deployFromVersionMock).not.toHaveBeenCalled();
  });

  // 7. No NodePipelineStatus rows → error rate is null, no rollback
  it("skips rollback when there are no status rows (null error rate)", async () => {
    const pipeline = makePipelineCandidate();
    prismaMock.pipeline.findMany.mockResolvedValue([pipeline] as never);
    prismaMock.pipelineVersion.findMany.mockResolvedValue(
      makeVersions() as never,
    );
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([] as never);

    await service.checkPipelines();

    expect(deployFromVersionMock).not.toHaveBeenCalled();
  });

  // 8. Error during rollback → caught, does not crash, other pipelines still processed
  it("catches rollback errors and continues processing other pipelines", async () => {
    const pipeline1 = makePipelineCandidate({ id: "pipe-1", name: "Pipeline 1" });
    const pipeline2 = makePipelineCandidate({ id: "pipe-2", name: "Pipeline 2" });
    prismaMock.pipeline.findMany.mockResolvedValue([pipeline1, pipeline2] as never);

    // Both pipelines have versions
    prismaMock.pipelineVersion.findMany
      .mockResolvedValueOnce(makeVersions() as never)
      .mockResolvedValueOnce(
        makeVersions({
          latest: { id: "ver-4", version: 4, createdById: "user-2" },
          previous: { id: "ver-3", version: 3, createdById: "user-2" },
        }) as never,
      );

    // Both pipelines have high error rates
    prismaMock.nodePipelineStatus.findMany
      .mockResolvedValueOnce(makeStatusRows(BigInt(1000), BigInt(100)) as never)
      .mockResolvedValueOnce(makeStatusRows(BigInt(1000), BigInt(200)) as never);

    // First pipeline rollback throws
    deployFromVersionMock
      .mockRejectedValueOnce(new Error("DB connection lost"))
      .mockResolvedValueOnce({ version: {} as never, pushedNodeIds: [] });

    prismaMock.pipeline.update.mockResolvedValue({} as never);
    fireEventAlertMock.mockResolvedValue();

    // Should not throw
    await service.checkPipelines();

    // Second pipeline should still have been processed
    expect(deployFromVersionMock).toHaveBeenCalledTimes(2);
    expect(deployFromVersionMock).toHaveBeenLastCalledWith(
      "pipe-2",
      "ver-3",
      "user-2",
      expect.stringContaining("Auto-rollback"),
    );
  });

  // ─── Negative test: null createdById on latest version ─────────────

  it("skips rollback when latest version has null createdById", async () => {
    const pipeline = makePipelineCandidate();
    prismaMock.pipeline.findMany.mockResolvedValue([pipeline] as never);
    prismaMock.pipelineVersion.findMany.mockResolvedValue(
      makeVersions({ latest: { id: "ver-2", version: 2, createdById: null } }) as never,
    );
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue(
      makeStatusRows(BigInt(1000), BigInt(100)) as never,
    );

    await service.checkPipelines();

    expect(deployFromVersionMock).not.toHaveBeenCalled();
  });

  // ─── getAggregateErrorRate unit tests ─────────────────────────────

  it("getAggregateErrorRate computes correctly across multiple nodes", async () => {
    // Node 1: 500 events, 30 errors; Node 2: 500 events, 20 errors
    // Total: 1000 events, 50 errors → 5%
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      { eventsIn: BigInt(500), errorsTotal: BigInt(30) },
      { eventsIn: BigInt(500), errorsTotal: BigInt(20) },
    ] as never);

    const rate = await getAggregateErrorRate("pipe-1");
    expect(rate).toBe(5);
  });

  // ─── Lifecycle tests ──────────────────────────────────────────────

  it("start() creates an interval that calls checkPipelines", () => {
    prismaMock.pipeline.findMany.mockResolvedValue([]);

    service.start();
    vi.advanceTimersByTime(30_000);

    expect(prismaMock.pipeline.findMany).toHaveBeenCalled();
  });

  it("stop() clears the interval", () => {
    prismaMock.pipeline.findMany.mockResolvedValue([]);

    service.start();
    service.stop();

    vi.advanceTimersByTime(60_000);

    expect(prismaMock.pipeline.findMany).not.toHaveBeenCalled();
  });
});
