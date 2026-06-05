import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => {
  const __pm = mockDeep<PrismaClient>();
  return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
});
vi.mock("@/lib/logger", () => ({ debugLog: vi.fn(), infoLog: vi.fn(), errorLog: vi.fn() }));

import { prisma } from "@/lib/prisma";
import {
  analyzeCardinality,
  detectHighCardinality,
} from "@/server/services/cost-optimizer";
import type { PipelineAggregates, SuggestedAction } from "@/server/services/cost-optimizer-types";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
});

/** Events with a near-unique `req_id`, a 2-value `level`, and a constant `service`. */
function nearUniqueEvents(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    req_id: `req-${i}-${i * 7919}`,
    level: i % 2 === 0 ? "info" : "error",
    service: "api",
  }));
}

function makeAgg(overrides: Partial<PipelineAggregates> = {}): PipelineAggregates {
  return {
    pipelineId: "pipe-1",
    pipelineName: "hi-card",
    environmentId: "env-1",
    teamId: "team-1",
    totalBytesIn: BigInt(2_000_000_000), // 2 GB → high volume
    totalBytesOut: BigInt(2_000_000_000),
    totalEventsIn: BigInt(1_000_000),
    totalEventsOut: BigInt(1_000_000),
    totalErrors: BigInt(0),
    totalDiscarded: BigInt(0),
    metricCount: 100,
    ...overrides,
  };
}

describe("analyzeCardinality", () => {
  it("flags a near-unique field but not low-distinct or constant fields", () => {
    const offenders = analyzeCardinality(nearUniqueEvents(30));
    const fields = offenders.map((o) => o.field);

    expect(fields).toContain("req_id");
    expect(fields).not.toContain("level");
    expect(fields).not.toContain("service");

    const reqId = offenders.find((o) => o.field === "req_id")!;
    expect(reqId.distinctCount).toBe(30);
    expect(reqId.presentCount).toBe(30);
    expect(reqId.ratio).toBeGreaterThanOrEqual(0.9);
  });

  it("does not flag a field whose values are not near-unique", () => {
    const events = Array.from({ length: 40 }, (_, i) => ({ level: i % 3 === 0 ? "warn" : "info" }));
    expect(analyzeCardinality(events)).toHaveLength(0);
  });

  it("does not flag when the sample is below the minimum size", () => {
    expect(analyzeCardinality(nearUniqueEvents(5))).toHaveLength(0);
  });

  it("ignores non-object events", () => {
    expect(analyzeCardinality(["x", 1, null, [1, 2]])).toHaveLength(0);
  });
});

describe("detectHighCardinality", () => {
  it("emits a HIGH_CARDINALITY recommendation naming the offending field", async () => {
    prismaMock.tapCapture.findFirst.mockResolvedValue({
      events: nearUniqueEvents(30),
    } as never);

    const results = await detectHighCardinality([makeAgg()]);

    expect(results).toHaveLength(1);
    const rec = results[0];
    expect(rec.type).toBe("HIGH_CARDINALITY");
    expect(rec.pipelineId).toBe("pipe-1");

    const action = rec.suggestedAction as SuggestedAction;
    expect(action.type).toBe("drop_field");
    if (action.type === "drop_field") {
      expect(action.config.fields).toContain("req_id");
    }

    const data = rec.analysisData as { fields: { field: string }[]; sampleSize: number };
    expect(data.sampleSize).toBe(30);
    expect(data.fields.some((f) => f.field === "req_id")).toBe(true);

    expect(rec.estimatedSavingsBytes).not.toBeNull();
    expect(Number(rec.estimatedSavingsBytes)).toBeGreaterThan(0);
  });

  it("falls back to the latest EventSample when no TapCapture exists", async () => {
    prismaMock.tapCapture.findFirst.mockResolvedValue(null as never);
    prismaMock.eventSample.findFirst.mockResolvedValue({
      events: nearUniqueEvents(25),
    } as never);

    const results = await detectHighCardinality([makeAgg()]);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("HIGH_CARDINALITY");
  });

  it("skips cleanly when there is no event sample", async () => {
    prismaMock.tapCapture.findFirst.mockResolvedValue(null as never);
    prismaMock.eventSample.findFirst.mockResolvedValue(null as never);

    const results = await detectHighCardinality([makeAgg()]);
    expect(results).toHaveLength(0);
  });

  it("skips low-volume pipelines without querying for events", async () => {
    const results = await detectHighCardinality([makeAgg({ totalBytesIn: BigInt(1000) })]);
    expect(results).toHaveLength(0);
    expect(prismaMock.tapCapture.findFirst).not.toHaveBeenCalled();
  });
});
