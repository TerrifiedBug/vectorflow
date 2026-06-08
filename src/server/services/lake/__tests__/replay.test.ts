import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// Mock the A1 ClickHouse wrapper so no real connection is attempted and we can
// assert the exact SQL + bound params the replay queries build.
const { isLakeEnabledMock, lakeQueryMock } = vi.hoisted(() => ({
  isLakeEnabledMock: vi.fn<() => boolean>(() => true),
  lakeQueryMock: vi.fn<(sql: string, params?: Record<string, unknown>) => Promise<unknown[]>>(),
}));

vi.mock("@/server/services/lake/clickhouse", () => ({
  isLakeEnabled: isLakeEnabledMock,
  lakeQuery: lakeQueryMock,
}));

// withOrgTx → basePrisma.$transaction(fn) after a set_config $executeRaw. Wire
// the deep mock to run the callback so the REAL withOrgTx is exercised.
vi.mock("@/lib/prisma", () => {
  const __pm = mockDeep<PrismaClient>();
  return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
});

import { prisma } from "@/lib/prisma";
import {
  createReplayJob,
  nextReplayBatch,
  cancelReplayJob,
  getReplayJob,
  listReplayJobs,
  ReplayError,
} from "../replay";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const ORG = "org-a";
const FROM = new Date("2026-06-01T00:00:00.000Z");
const TO = new Date("2026-06-02T00:00:00.000Z");

/** A minimal lake_events row as ClickHouse JSONEachRow returns it. */
function lakeEvent(message: string) {
  return {
    organizationId: ORG,
    pipelineId: "src",
    eventType: "log",
    timestamp: "2026-06-01 00:00:00.000",
    traceId: "",
    spanId: "",
    host: "h",
    source: "s",
    severity: "info",
    message,
    raw: `{"m":"${message}"}`,
    attrs: {},
  };
}

/** A persisted ReplayJob fixture with BigInt counters. */
function jobFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    organizationId: ORG,
    sourcePipelineId: "src",
    targetPipelineId: "tgt",
    fromTime: FROM,
    toTime: TO,
    filter: null,
    status: "PENDING",
    totalEvents: BigInt(10),
    replayedEvents: BigInt(0),
    dedupeKey: "rpl_dedupe",
    error: null,
    createdById: "user-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockReset(prismaMock);
  isLakeEnabledMock.mockReturnValue(true);
  lakeQueryMock.mockReset();
  lakeQueryMock.mockResolvedValue([]);
  // Real withOrgTx runs against the deep mock.
  prismaMock.$transaction.mockImplementation(
    async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
  );
  prismaMock.$executeRaw.mockResolvedValue(1 as never);
});

describe("createReplayJob", () => {
  it("creates a PENDING job with a dedupeKey and totalEvents from the lake count", async () => {
    lakeQueryMock.mockResolvedValueOnce([{ c: "42" }]);
    prismaMock.pipeline.findFirst
      .mockResolvedValueOnce({ id: "src" } as never)
      .mockResolvedValueOnce({ id: "tgt" } as never);
    prismaMock.replayJob.create.mockResolvedValue(
      jobFixture({ totalEvents: BigInt(42) }) as never,
    );

    const job = await createReplayJob({
      orgId: ORG,
      sourcePipelineId: "src",
      targetPipelineId: "tgt",
      fromTime: FROM,
      toTime: TO,
      userId: "user-1",
    });

    // Count is org+source-scoped and bound, never interpolated.
    const [countSql, countParams] = lakeQueryMock.mock.calls[0];
    expect(countSql).toContain("count()");
    expect(countSql).toContain("organizationId = {orgId:String}");
    expect(countParams).toMatchObject({ orgId: ORG, pipelineId: "src" });

    expect(prismaMock.replayJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG,
          sourcePipelineId: "src",
          targetPipelineId: "tgt",
          status: "PENDING",
          totalEvents: BigInt(42),
          replayedEvents: BigInt(0),
          dedupeKey: expect.stringMatching(/^rpl_[0-9a-f]{40}$/),
          createdById: "user-1",
        }),
      }),
    );
    expect(job.status).toBe("PENDING");
  });

  it("produces a deterministic dedupeKey for identical replay requests", async () => {
    lakeQueryMock.mockResolvedValue([{ c: "1" }]);
    prismaMock.pipeline.findFirst.mockResolvedValue({ id: "x" } as never);
    prismaMock.replayJob.create.mockResolvedValue(jobFixture() as never);

    const args = {
      orgId: ORG,
      sourcePipelineId: "src",
      targetPipelineId: "tgt",
      fromTime: FROM,
      toTime: TO,
    };
    await createReplayJob(args);
    await createReplayJob(args);

    const key1 = (prismaMock.replayJob.create.mock.calls[0][0] as { data: { dedupeKey: string } })
      .data.dedupeKey;
    const key2 = (prismaMock.replayJob.create.mock.calls[1][0] as { data: { dedupeKey: string } })
      .data.dedupeKey;
    expect(key1).toBe(key2);
  });

  it("stores and binds the optional filter (eventType)", async () => {
    lakeQueryMock.mockResolvedValueOnce([{ c: "3" }]);
    prismaMock.pipeline.findFirst
      .mockResolvedValueOnce({ id: "src" } as never)
      .mockResolvedValueOnce({ id: "tgt" } as never);
    prismaMock.replayJob.create.mockResolvedValue(jobFixture() as never);

    await createReplayJob({
      orgId: ORG,
      sourcePipelineId: "src",
      targetPipelineId: "tgt",
      fromTime: FROM,
      toTime: TO,
      filter: { eventType: "trace" },
    });

    const [countSql, countParams] = lakeQueryMock.mock.calls[0];
    expect(countSql).toContain("eventType = {eventType:String}");
    expect(countParams).toMatchObject({ eventType: "trace" });
    expect(prismaMock.replayJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ filter: { eventType: "trace" } }),
      }),
    );
  });

  it("throws LAKE_DISABLED and never counts or writes when the lake is off", async () => {
    isLakeEnabledMock.mockReturnValue(false);
    await expect(
      createReplayJob({
        orgId: ORG,
        sourcePipelineId: "src",
        targetPipelineId: "tgt",
        fromTime: FROM,
        toTime: TO,
      }),
    ).rejects.toMatchObject({ code: "LAKE_DISABLED" });
    expect(lakeQueryMock).not.toHaveBeenCalled();
    expect(prismaMock.replayJob.create).not.toHaveBeenCalled();
  });

  it("rejects a source pipeline outside the org", async () => {
    lakeQueryMock.mockResolvedValueOnce([{ c: "1" }]);
    prismaMock.pipeline.findFirst
      .mockResolvedValueOnce(null) // source not in org
      .mockResolvedValueOnce({ id: "tgt" } as never);

    await expect(
      createReplayJob({
        orgId: ORG,
        sourcePipelineId: "src",
        targetPipelineId: "tgt",
        fromTime: FROM,
        toTime: TO,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });
    expect(prismaMock.replayJob.create).not.toHaveBeenCalled();
  });
});

describe("nextReplayBatch", () => {
  it("returns null and never touches the DB when the lake is off", async () => {
    isLakeEnabledMock.mockReturnValue(false);
    const result = await nextReplayBatch({ orgId: ORG, targetPipelineId: "tgt", batchSize: 5 });
    expect(result).toBeNull();
    expect(prismaMock.replayJob.findFirst).not.toHaveBeenCalled();
  });

  it("returns null when there is no active job for the target", async () => {
    prismaMock.replayJob.findFirst.mockResolvedValue(null);
    const result = await nextReplayBatch({ orgId: ORG, targetPipelineId: "tgt", batchSize: 5 });
    expect(result).toBeNull();
    // Find is org + target + active-status scoped.
    expect(prismaMock.replayJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG,
          targetPipelineId: "tgt",
          status: { in: ["PENDING", "RUNNING"] },
        }),
      }),
    );
  });

  it("serves a full batch, advances replayedEvents, flips PENDING→RUNNING and stamps the dedupeKey", async () => {
    prismaMock.replayJob.findFirst.mockResolvedValue(
      jobFixture({ status: "PENDING", replayedEvents: BigInt(0), totalEvents: BigInt(10) }) as never,
    );
    lakeQueryMock.mockResolvedValueOnce([lakeEvent("a"), lakeEvent("b"), lakeEvent("c")]);
    prismaMock.replayJob.updateMany.mockResolvedValue({ count: 1 } as never);

    const result = await nextReplayBatch({ orgId: ORG, targetPipelineId: "tgt", batchSize: 3 });

    // Cursor read uses OFFSET = prior replayedEvents (bound as a string).
    const [fetchSql, fetchParams] = lakeQueryMock.mock.calls[0];
    expect(fetchSql).toContain("ORDER BY timestamp ASC");
    expect(fetchSql).toContain("OFFSET {offset:UInt64}");
    expect(fetchParams).toMatchObject({ offset: "0", limit: 3 });

    expect(prismaMock.replayJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1", status: { in: ["PENDING", "RUNNING"] }, replayedEvents: BigInt(0) },
        data: expect.objectContaining({
          status: "RUNNING",
          replayedEvents: BigInt(3),
          startedAt: expect.any(Date),
        }),
      }),
    );
    expect(result).toMatchObject({
      jobId: "job-1",
      status: "RUNNING",
      done: false,
      replayedEvents: BigInt(3),
    });
    expect(result?.events).toHaveLength(3);
    for (const event of result!.events) {
      expect(event.replayJobId).toBe("job-1");
      expect(event.replayDedupeKey).toBe("rpl_dedupe");
    }
  });

  it("flips to COMPLETED with completedAt when the window drains (short read)", async () => {
    prismaMock.replayJob.findFirst.mockResolvedValue(
      jobFixture({ status: "RUNNING", replayedEvents: BigInt(7), totalEvents: BigInt(10), startedAt: FROM }) as never,
    );
    lakeQueryMock.mockResolvedValueOnce([lakeEvent("h"), lakeEvent("i"), lakeEvent("j")]);
    prismaMock.replayJob.updateMany.mockResolvedValue({ count: 1 } as never);

    const result = await nextReplayBatch({ orgId: ORG, targetPipelineId: "tgt", batchSize: 5 });

    expect(prismaMock.replayJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETED",
          replayedEvents: BigInt(10),
          completedAt: expect.any(Date),
        }),
      }),
    );
    expect(result).toMatchObject({ status: "COMPLETED", done: true, replayedEvents: BigInt(10) });
  });

  it("marks the job FAILED with a reason when the drained replay served fewer than totalEvents (NF-6)", async () => {
    // Estimated 10 events at create, but the window drains after only 3 (short
    // read) → cumulative 3 < 10 → FAILED with a reason, not a silent COMPLETED.
    prismaMock.replayJob.findFirst.mockResolvedValue(
      jobFixture({ status: "RUNNING", replayedEvents: BigInt(0), totalEvents: BigInt(10), startedAt: FROM }) as never,
    );
    lakeQueryMock.mockResolvedValueOnce([lakeEvent("a"), lakeEvent("b"), lakeEvent("c")]);
    prismaMock.replayJob.updateMany.mockResolvedValue({ count: 1 } as never);

    const result = await nextReplayBatch({ orgId: ORG, targetPipelineId: "tgt", batchSize: 5 });

    expect(prismaMock.replayJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          replayedEvents: BigInt(3),
          completedAt: expect.any(Date),
          error: expect.stringContaining("3 of 10"),
        }),
      }),
    );
    expect(result).toMatchObject({ status: "FAILED", done: true, replayedEvents: BigInt(3) });
    // The final partial batch is still handed back — those events are real lake rows.
    expect(result?.events).toHaveLength(3);
  });

  it("marks COMPLETED and clears the error when the drained replay met or exceeded totalEvents (NF-6)", async () => {
    // totalEvents was under-counted at create (the lake grew afterwards); the
    // window drains at 3 >= 2 → COMPLETED, with `error` explicitly cleared.
    prismaMock.replayJob.findFirst.mockResolvedValue(
      jobFixture({ status: "RUNNING", replayedEvents: BigInt(0), totalEvents: BigInt(2), startedAt: FROM }) as never,
    );
    lakeQueryMock.mockResolvedValueOnce([lakeEvent("a"), lakeEvent("b"), lakeEvent("c")]);
    prismaMock.replayJob.updateMany.mockResolvedValue({ count: 1 } as never);

    const result = await nextReplayBatch({ orgId: ORG, targetPipelineId: "tgt", batchSize: 5 });

    expect(prismaMock.replayJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETED",
          replayedEvents: BigInt(3),
          completedAt: expect.any(Date),
          error: null,
        }),
      }),
    );
    expect(result).toMatchObject({ status: "COMPLETED", done: true, replayedEvents: BigInt(3) });
  });

  it("completes immediately on an empty window (totalEvents 0)", async () => {
    prismaMock.replayJob.findFirst.mockResolvedValue(
      jobFixture({ status: "PENDING", replayedEvents: BigInt(0), totalEvents: BigInt(0) }) as never,
    );
    lakeQueryMock.mockResolvedValueOnce([]);
    prismaMock.replayJob.updateMany.mockResolvedValue({ count: 1 } as never);

    const result = await nextReplayBatch({ orgId: ORG, targetPipelineId: "tgt", batchSize: 5 });
    expect(result).toMatchObject({ status: "COMPLETED", done: true, replayedEvents: BigInt(0) });
    expect(result?.events).toHaveLength(0);
  });

  it("discards the batch and advances nothing when the guarded update matches no row (cancel or a concurrent pull)", async () => {
    prismaMock.replayJob.findFirst.mockResolvedValue(
      jobFixture({ status: "RUNNING", replayedEvents: BigInt(0), totalEvents: BigInt(10) }) as never,
    );
    lakeQueryMock.mockResolvedValueOnce([lakeEvent("a"), lakeEvent("b")]);
    // The guarded update (status + replayedEvents) matches no row → the job was cancelled/completed, or a concurrent pull advanced the cursor first.
    prismaMock.replayJob.updateMany.mockResolvedValue({ count: 0 } as never);

    const result = await nextReplayBatch({ orgId: ORG, targetPipelineId: "tgt", batchSize: 2 });
    expect(result).toBeNull();
  });
});

describe("cancelReplayJob", () => {
  it("cancels an active job, stamps completedAt and leaves counters untouched", async () => {
    prismaMock.replayJob.findFirst.mockResolvedValue(
      jobFixture({ status: "RUNNING", replayedEvents: BigInt(4), totalEvents: BigInt(10) }) as never,
    );
    prismaMock.replayJob.update.mockResolvedValue(
      jobFixture({ status: "CANCELLED", replayedEvents: BigInt(4), totalEvents: BigInt(10) }) as never,
    );

    const job = await cancelReplayJob({ orgId: ORG, jobId: "job-1" });

    expect(prismaMock.replayJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "CANCELLED", completedAt: expect.any(Date) },
    });
    // No counter mutation in the update payload — partial progress is preserved.
    const data = prismaMock.replayJob.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty("replayedEvents");
    expect(data).not.toHaveProperty("totalEvents");
    expect(job.status).toBe("CANCELLED");
  });

  it("is idempotent on an already-cancelled job (no update)", async () => {
    prismaMock.replayJob.findFirst.mockResolvedValue(jobFixture({ status: "CANCELLED" }) as never);
    const job = await cancelReplayJob({ orgId: ORG, jobId: "job-1" });
    expect(job.status).toBe("CANCELLED");
    expect(prismaMock.replayJob.update).not.toHaveBeenCalled();
  });

  it("refuses to cancel a COMPLETED job", async () => {
    prismaMock.replayJob.findFirst.mockResolvedValue(jobFixture({ status: "COMPLETED" }) as never);
    await expect(cancelReplayJob({ orgId: ORG, jobId: "job-1" })).rejects.toMatchObject({
      code: "NOT_CANCELLABLE",
    });
    expect(prismaMock.replayJob.update).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND for an unknown / cross-org job id", async () => {
    prismaMock.replayJob.findFirst.mockResolvedValue(null);
    await expect(cancelReplayJob({ orgId: "org-b", jobId: "job-1" })).rejects.toBeInstanceOf(
      ReplayError,
    );
    // Lookup is org-scoped, so org-b can never see org-a's job.
    expect(prismaMock.replayJob.findFirst).toHaveBeenCalledWith({
      where: { id: "job-1", organizationId: "org-b" },
    });
  });
});

describe("getReplayJob / listReplayJobs — org scoping", () => {
  it("getReplayJob scopes the lookup to the org", async () => {
    prismaMock.replayJob.findFirst.mockResolvedValue(jobFixture() as never);
    await getReplayJob({ orgId: ORG, jobId: "job-1" });
    expect(prismaMock.replayJob.findFirst).toHaveBeenCalledWith({
      where: { id: "job-1", organizationId: ORG },
    });
  });

  it("listReplayJobs returns jobs touching a pipeline as source OR target, newest first", async () => {
    prismaMock.replayJob.findMany.mockResolvedValue([jobFixture()] as never);
    await listReplayJobs({ orgId: ORG, pipelineId: "p1" });
    expect(prismaMock.replayJob.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        OR: [{ sourcePipelineId: "p1" }, { targetPipelineId: "p1" }],
      },
      orderBy: { createdAt: "desc" },
    });
  });
});
