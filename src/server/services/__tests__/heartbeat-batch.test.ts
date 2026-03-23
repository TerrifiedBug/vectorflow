import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// Mock prisma before importing the module under test
vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import {
  batchUpsertPipelineStatuses,
  type PipelineStatusInput,
} from "@/server/services/heartbeat-batch";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// ─── Fixture helpers ────────────────────────────────────────────────────────

const NOW = new Date("2025-06-01T12:00:00Z");
const NODE_ID = "node-abc";

function makePipeline(
  overrides: Partial<PipelineStatusInput> & { pipelineId: string },
): PipelineStatusInput {
  return {
    version: 1,
    status: "RUNNING",
    eventsIn: 100,
    eventsOut: 90,
    errorsTotal: 2,
    eventsDiscarded: 0,
    bytesIn: 5000,
    bytesOut: 4500,
    utilization: 0.75,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("batchUpsertPipelineStatuses", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    // $executeRaw returns a count of affected rows
    prismaMock.$executeRaw.mockResolvedValue(0 as never);
  });

  // ── Empty pipeline array produces no SQL call ───────────────────────────

  it("skips SQL call when pipelines array is empty", async () => {
    await batchUpsertPipelineStatuses(NODE_ID, [], NOW);

    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
  });

  // ── Single pipeline triggers exactly one $executeRaw ────────────────────

  it("calls $executeRaw exactly once for a single pipeline", async () => {
    const pipelines = [makePipeline({ pipelineId: "pipe-1" })];

    await batchUpsertPipelineStatuses(NODE_ID, pipelines, NOW);

    expect(prismaMock.$executeRaw).toHaveBeenCalledOnce();
  });

  // ── Multiple pipelines still produce a single $executeRaw ───────────────

  it("calls $executeRaw exactly once for 5 pipelines", async () => {
    const pipelines = Array.from({ length: 5 }, (_, i) =>
      makePipeline({ pipelineId: `pipe-${i}` }),
    );

    await batchUpsertPipelineStatuses(NODE_ID, pipelines, NOW);

    expect(prismaMock.$executeRaw).toHaveBeenCalledOnce();
  });

  // ── 100 pipelines still produce a single $executeRaw ────────────────────

  it("calls $executeRaw exactly once for 100 pipelines", async () => {
    const pipelines = Array.from({ length: 100 }, (_, i) =>
      makePipeline({ pipelineId: `pipe-${i}` }),
    );

    await batchUpsertPipelineStatuses(NODE_ID, pipelines, NOW);

    expect(prismaMock.$executeRaw).toHaveBeenCalledOnce();
  });

  // ── SQL contains the ProcessStatus enum cast ────────────────────────────

  it("includes ProcessStatus cast in the generated SQL", async () => {
    const pipelines = [makePipeline({ pipelineId: "pipe-1", status: "CRASHED" })];

    await batchUpsertPipelineStatuses(NODE_ID, pipelines, NOW);

    // $executeRaw is called as a tagged template: (TemplateStringsArray, ...values).
    // The outer template has the INSERT/ON CONFLICT SQL. The Prisma.join() result
    // is passed as arg[1] — a Prisma.Sql object whose .strings contain the
    // per-row value templates including the ::"ProcessStatus" cast.
    const call = prismaMock.$executeRaw.mock.calls[0]!;
    const outerStrings = call[0] as unknown as string[];
    const outerSql = outerStrings.join("$1");

    expect(outerSql).toContain('ON CONFLICT ("nodeId", "pipelineId") DO UPDATE SET');
    expect(outerSql).toContain('INSERT INTO "NodePipelineStatus"');

    // The inner Prisma.Sql from Prisma.join() contains the ::"ProcessStatus" cast
    const innerSql = call[1] as { strings: readonly string[] };
    const innerStaticSql = innerSql.strings.join("?");
    expect(innerStaticSql).toContain('::"ProcessStatus"');
  });

  // ── Handles null optional fields correctly ──────────────────────────────

  it("handles pipelines with null/undefined optional fields", async () => {
    const pipelines = [
      makePipeline({
        pipelineId: "pipe-sparse",
        pid: undefined,
        uptimeSeconds: undefined,
        eventsIn: undefined,
        eventsOut: undefined,
        errorsTotal: undefined,
        eventsDiscarded: undefined,
        bytesIn: undefined,
        bytesOut: undefined,
        utilization: undefined,
        recentLogs: undefined,
      }),
    ];

    await batchUpsertPipelineStatuses(NODE_ID, pipelines, NOW);

    expect(prismaMock.$executeRaw).toHaveBeenCalledOnce();

    // Verify the inner Prisma.Sql values contain null for pid/uptimeSeconds/recentLogs
    // and 0 for numeric counters
    const call = prismaMock.$executeRaw.mock.calls[0]!;
    const innerSql = call[1] as { values: unknown[] };
    expect(innerSql.values).toContain(null);
    expect(innerSql.values).toContain(0);
  });

  // ── Handles recentLogs JSON serialization ───────────────────────────────

  it("serializes recentLogs as JSON string when present", async () => {
    const logs = ["error: connection reset", "warn: retry attempt 3"];
    const pipelines = [makePipeline({ pipelineId: "pipe-logs", recentLogs: logs })];

    await batchUpsertPipelineStatuses(NODE_ID, pipelines, NOW);

    expect(prismaMock.$executeRaw).toHaveBeenCalledOnce();

    // Verify ::jsonb cast appears in the inner SQL strings and
    // the serialized JSON is in the values
    const call = prismaMock.$executeRaw.mock.calls[0]!;
    const innerSql = call[1] as { strings: readonly string[]; values: unknown[] };
    const innerStaticSql = innerSql.strings.join("?");
    expect(innerStaticSql).toContain("::jsonb");
    expect(innerSql.values).toContain(JSON.stringify(logs));
  });

  // ── Ordering invariant: $executeRaw completes before function returns ───

  it("awaits $executeRaw before returning (ordering invariant)", async () => {
    const callOrder: string[] = [];

    prismaMock.$executeRaw.mockImplementation((() => {
      callOrder.push("executeRaw");
      return Promise.resolve(0);
    }) as never);

    const pipelines = [makePipeline({ pipelineId: "pipe-1" })];
    await batchUpsertPipelineStatuses(NODE_ID, pipelines, NOW);
    callOrder.push("after-batch");

    // executeRaw must complete before the function returns
    expect(callOrder).toEqual(["executeRaw", "after-batch"]);
  });

  // ── Propagates database errors ──────────────────────────────────────────

  it("propagates $executeRaw errors to the caller", async () => {
    prismaMock.$executeRaw.mockRejectedValue(new Error("connection timeout") as never);

    const pipelines = [makePipeline({ pipelineId: "pipe-1" })];

    await expect(
      batchUpsertPipelineStatuses(NODE_ID, pipelines, NOW),
    ).rejects.toThrow("connection timeout");
  });
});
