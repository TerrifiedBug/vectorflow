import { describe, it, expect, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    isLakeEnabled: vi.fn(),
    command: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("@/server/services/lake/clickhouse", () => ({
  isLakeEnabled: mocks.isLakeEnabled,
  getLakeClient: () => ({ command: mocks.command }),
}));

vi.mock("@/lib/prisma", () => {
  const client = { lakeDataset: { findMany: mocks.findMany } };
  return { prisma: client, basePrisma: client, adminPrisma: client };
});

vi.mock("@/lib/logger", () => ({
  errorLog: vi.fn(),
  warnLog: vi.fn(),
  infoLog: vi.fn(),
  debugLog: vi.fn(),
}));

vi.mock("@/server/services/leader-election", () => ({ isLeader: vi.fn(() => true) }));

import {
  effectiveRetention,
  buildLakeTtlClause,
  enforceDatasetRetention,
  sweepLakeRetention,
  LAKE_DEFAULT_HOT_DAYS,
  LAKE_DEFAULT_COLD_DAYS,
} from "../lake-retention";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Extract the single object argument of the Nth `command()` call. */
function commandCall(n: number): {
  query: string;
  query_params: { orgId: string; pipelineId: string; cutoff: Date };
} {
  return mocks.command.mock.calls[n][0] as {
    query: string;
    query_params: { orgId: string; pipelineId: string; cutoff: Date };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.command.mockResolvedValue(undefined);
});

describe("effectiveRetention", () => {
  it("falls back to the table defaults when there is no policy", () => {
    expect(effectiveRetention(null)).toEqual({
      hotDays: LAKE_DEFAULT_HOT_DAYS,
      coldDays: LAKE_DEFAULT_COLD_DAYS,
    });
    expect(effectiveRetention(undefined)).toEqual({ hotDays: 7, coldDays: 90 });
  });

  it("honours a per-dataset policy", () => {
    expect(effectiveRetention({ hotDays: 3, coldDays: 30 })).toEqual({ hotDays: 3, coldDays: 30 });
  });

  it("falls back on non-positive windows", () => {
    expect(effectiveRetention({ hotDays: 0, coldDays: -5 })).toEqual({ hotDays: 7, coldDays: 90 });
  });

  it("clamps coldDays up to hotDays so the drop horizon never precedes the move", () => {
    expect(effectiveRetention({ hotDays: 30, coldDays: 10 })).toEqual({ hotDays: 30, coldDays: 30 });
  });
});

describe("buildLakeTtlClause", () => {
  it("cold-tier disabled → DELETE-only at coldDays (plain MergeTree)", () => {
    const clause = buildLakeTtlClause({ hotDays: 7, coldDays: 90 }, false);
    expect(clause).toBe("TTL toDateTime(timestamp) + INTERVAL 90 DAY DELETE");
    expect(clause).not.toContain("TO VOLUME 'cold'");
    expect(clause).not.toContain("storage_policy");
  });

  it("cold-tier enabled → move-to-cold at hotDays + DELETE at coldDays + storage policy", () => {
    const clause = buildLakeTtlClause({ hotDays: 7, coldDays: 90 }, true);
    expect(clause).toContain("INTERVAL 7 DAY TO VOLUME 'cold'");
    expect(clause).toContain("INTERVAL 90 DAY DELETE");
    expect(clause).toContain("storage_policy = 'vf_hot_cold'");
  });

  it("reflects a per-dataset window", () => {
    const clause = buildLakeTtlClause(effectiveRetention({ hotDays: 1, coldDays: 14 }), false);
    expect(clause).toBe("TTL toDateTime(timestamp) + INTERVAL 14 DAY DELETE");
  });
});

describe("enforceDatasetRetention", () => {
  it("no-ops when the lake is disabled (never connects)", async () => {
    mocks.isLakeEnabled.mockReturnValue(false);

    const r = await enforceDatasetRetention({ orgId: "org-1", pipelineId: "pipe-1" });

    expect(r).toBeNull();
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it("deletes events older than the policy's coldDays horizon, org+pipeline scoped", async () => {
    mocks.isLakeEnabled.mockReturnValue(true);
    const now = new Date("2026-06-08T00:00:00.000Z");

    const r = await enforceDatasetRetention({
      orgId: "org-1",
      pipelineId: "pipe-1",
      policy: { hotDays: 3, coldDays: 30 },
      now,
    });

    expect(r).toEqual({
      pipelineId: "pipe-1",
      coldDays: 30,
      cutoff: new Date(now.getTime() - 30 * MS_PER_DAY).toISOString(),
    });
    const call = commandCall(0);
    expect(call.query).toContain("DELETE FROM lake_events");
    expect(call.query).toContain("organizationId = {orgId:String}");
    expect(call.query).toContain("pipelineId = {pipelineId:String}");
    expect(call.query).toContain("timestamp < {cutoff:DateTime64(3)}");
    expect(call.query_params.orgId).toBe("org-1");
    expect(call.query_params.pipelineId).toBe("pipe-1");
    expect(call.query_params.cutoff).toEqual(new Date(now.getTime() - 30 * MS_PER_DAY));
  });

  it("uses the default 90-day horizon when the dataset has no policy", async () => {
    mocks.isLakeEnabled.mockReturnValue(true);
    const now = new Date("2026-06-08T00:00:00.000Z");

    const r = await enforceDatasetRetention({ orgId: "org-1", pipelineId: "pipe-1", now });

    expect(r?.coldDays).toBe(90);
    expect(commandCall(0).query_params.cutoff).toEqual(new Date(now.getTime() - 90 * MS_PER_DAY));
  });
});

describe("sweepLakeRetention", () => {
  it("no-ops when the lake is disabled", async () => {
    mocks.isLakeEnabled.mockReturnValue(false);

    const r = await sweepLakeRetention();

    expect(r).toEqual({ skipped: true, swept: 0, errors: 0 });
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it("enforces each dataset's own effective horizon", async () => {
    mocks.isLakeEnabled.mockReturnValue(true);
    const now = new Date("2026-06-08T00:00:00.000Z");
    mocks.findMany.mockResolvedValue([
      { organizationId: "org-1", pipelineId: "pipe-a", retentionPolicy: { hotDays: 1, coldDays: 7 } },
      { organizationId: "org-2", pipelineId: "pipe-b", retentionPolicy: null },
    ]);

    const r = await sweepLakeRetention(now);

    expect(r).toEqual({ skipped: false, swept: 2, errors: 0 });
    expect(mocks.command).toHaveBeenCalledTimes(2);
    // Dataset A: 7-day horizon for org-1/pipe-a.
    expect(commandCall(0).query_params).toMatchObject({ orgId: "org-1", pipelineId: "pipe-a" });
    expect(commandCall(0).query_params.cutoff).toEqual(new Date(now.getTime() - 7 * MS_PER_DAY));
    // Dataset B: default 90-day horizon for org-2/pipe-b.
    expect(commandCall(1).query_params).toMatchObject({ orgId: "org-2", pipelineId: "pipe-b" });
    expect(commandCall(1).query_params.cutoff).toEqual(new Date(now.getTime() - 90 * MS_PER_DAY));
  });

  it("logs + counts a per-dataset failure and continues the sweep", async () => {
    mocks.isLakeEnabled.mockReturnValue(true);
    mocks.findMany.mockResolvedValue([
      { organizationId: "org-1", pipelineId: "pipe-a", retentionPolicy: null },
      { organizationId: "org-2", pipelineId: "pipe-b", retentionPolicy: null },
    ]);
    mocks.command.mockRejectedValueOnce(new Error("clickhouse down")).mockResolvedValue(undefined);

    const r = await sweepLakeRetention();

    expect(r.skipped).toBe(false);
    expect(r.errors).toBe(1);
    expect(r.swept).toBe(1);
    expect(mocks.command).toHaveBeenCalledTimes(2);
  });
});
