import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { LakeAlertRule, PrismaClient } from "@/generated/prisma";

// Mock the ClickHouse wrapper so aggregateValue (real) returns a controlled
// scalar, and channel dispatch / org-scoped writes are observable.
const { isLakeEnabledMock, lakeQueryMock, deliverMock, updateMock } = vi.hoisted(() => ({
  isLakeEnabledMock: vi.fn<() => boolean>(() => true),
  lakeQueryMock: vi.fn<(sql: string, params?: Record<string, unknown>) => Promise<unknown[]>>(),
  deliverMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("@/server/services/lake/clickhouse", () => ({
  isLakeEnabled: isLakeEnabledMock,
  lakeQuery: lakeQueryMock,
}));
vi.mock("@/server/services/channels", () => ({ deliverToChannelById: deliverMock }));
// withOrgTx passes a tx whose lakeAlertRule.update is observable; runWithOrgContext
// is a transparent passthrough (org scoping is exercised in the RLS tests).
vi.mock("@/lib/with-org-tx", () => ({
  withOrgTx: (_orgId: string, fn: (tx: unknown) => unknown) =>
    fn({ lakeAlertRule: { update: updateMock } }),
}));
vi.mock("@/lib/org-context", () => ({
  runWithOrgContext: (_orgId: string, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/prisma", () => {
  const __pm = mockDeep<PrismaClient>();
  return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
});
vi.mock("@/lib/logger", () => ({
  infoLog: vi.fn(),
  errorLog: vi.fn(),
  warnLog: vi.fn(),
  debugLog: vi.fn(),
}));

import { adminPrisma } from "@/lib/prisma";
import {
  evaluateLakeAlertRules,
  comparatorCrosses,
  isRuleDue,
  parseLakeAlertSpec,
} from "../lake-alerts";

const adminMock = adminPrisma as unknown as DeepMockProxy<PrismaClient>;
const NOW = new Date("2026-06-05T12:00:00.000Z");

function makeRule(overrides: Partial<LakeAlertRule> = {}): LakeAlertRule {
  return {
    id: "rule-1",
    organizationId: "org-1",
    pipelineId: "p1",
    environmentId: "e1",
    name: "errors high",
    spec: { metric: "count", windowSeconds: 300 } as unknown,
    comparator: "GT",
    threshold: 10,
    intervalSeconds: 60,
    channelId: "chan-1",
    enabled: true,
    lastEvaluatedAt: null,
    lastFiredAt: null,
    lastValue: null,
    firing: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as LakeAlertRule;
}

beforeEach(() => {
  mockReset(adminMock);
  isLakeEnabledMock.mockReturnValue(true);
  lakeQueryMock.mockReset();
  lakeQueryMock.mockResolvedValue([]);
  deliverMock.mockReset();
  deliverMock.mockResolvedValue({ channelId: "chan-1", success: true });
  updateMock.mockReset();
  updateMock.mockResolvedValue({});
});

describe("comparatorCrosses", () => {
  it("evaluates each comparator at and around the threshold", () => {
    expect(comparatorCrosses(11, "GT", 10)).toBe(true);
    expect(comparatorCrosses(10, "GT", 10)).toBe(false);
    expect(comparatorCrosses(10, "GTE", 10)).toBe(true);
    expect(comparatorCrosses(9, "LT", 10)).toBe(true);
    expect(comparatorCrosses(10, "LT", 10)).toBe(false);
    expect(comparatorCrosses(10, "LTE", 10)).toBe(true);
    expect(comparatorCrosses(5, "??", 10)).toBe(false);
  });
});

describe("isRuleDue", () => {
  it("is due when never evaluated, and again after intervalSeconds elapse", () => {
    expect(isRuleDue({ lastEvaluatedAt: null, intervalSeconds: 60 }, NOW)).toBe(true);
    const justNow = new Date(NOW.getTime() - 10_000);
    expect(isRuleDue({ lastEvaluatedAt: justNow, intervalSeconds: 60 }, NOW)).toBe(false);
    const old = new Date(NOW.getTime() - 120_000);
    expect(isRuleDue({ lastEvaluatedAt: old, intervalSeconds: 60 }, NOW)).toBe(true);
  });
});

describe("parseLakeAlertSpec", () => {
  it("accepts a well-formed spec and rejects malformed ones", () => {
    expect(parseLakeAlertSpec({ metric: "count", windowSeconds: 300 })).toMatchObject({
      metric: "count",
      windowSeconds: 300,
    });
    expect(parseLakeAlertSpec({ metric: "avg", metricField: "attrs.x", windowSeconds: 60 })).toMatchObject(
      { metric: "avg", metricField: "attrs.x" },
    );
    expect(parseLakeAlertSpec(null)).toBeNull();
    expect(parseLakeAlertSpec({ windowSeconds: 300 })).toBeNull(); // no metric
    expect(parseLakeAlertSpec({ metric: "count", windowSeconds: 0 })).toBeNull(); // bad window
  });
});

describe("evaluateLakeAlertRules — edge-triggered firing", () => {
  it("fires once on the transition into crossing and dispatches firing", async () => {
    adminMock.lakeAlertRule.findMany.mockResolvedValue([makeRule()]);
    lakeQueryMock.mockResolvedValue([{ value: 25 }]); // count 25 > 10

    const r = await evaluateLakeAlertRules(NOW);

    expect(r).toEqual({ evaluated: 1, fired: 1, resolved: 0 });
    expect(deliverMock).toHaveBeenCalledTimes(1);
    const [channelId, environmentId, payload] = deliverMock.mock.calls[0];
    expect(channelId).toBe("chan-1");
    expect(environmentId).toBe("e1");
    expect(payload.status).toBe("firing");
    expect(payload.value).toBe(25);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rule-1" },
        data: expect.objectContaining({ firing: true, lastValue: 25, lastFiredAt: NOW }),
      }),
    );
  });

  it("does NOT re-fire while already firing, but still records the tick", async () => {
    adminMock.lakeAlertRule.findMany.mockResolvedValue([makeRule({ firing: true })]);
    lakeQueryMock.mockResolvedValue([{ value: 25 }]);

    const r = await evaluateLakeAlertRules(NOW);

    expect(r.fired).toBe(0);
    expect(deliverMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ firing: true, lastValue: 25 }) }),
    );
  });

  it("resolves on the transition out of crossing and dispatches resolved", async () => {
    adminMock.lakeAlertRule.findMany.mockResolvedValue([makeRule({ firing: true })]);
    lakeQueryMock.mockResolvedValue([{ value: 5 }]); // 5 is not > 10

    const r = await evaluateLakeAlertRules(NOW);

    expect(r.resolved).toBe(1);
    expect(deliverMock).toHaveBeenCalledTimes(1);
    expect(deliverMock.mock.calls[0][2].status).toBe("resolved");
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ firing: false }) }),
    );
  });

  it("transitions firing for an evaluate-only rule (no channel) without dispatch", async () => {
    adminMock.lakeAlertRule.findMany.mockResolvedValue([makeRule({ channelId: null })]);
    lakeQueryMock.mockResolvedValue([{ value: 25 }]);

    const r = await evaluateLakeAlertRules(NOW);

    expect(r.fired).toBe(1);
    expect(deliverMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ firing: true }) }),
    );
  });

  it("never fires or resolves on a null (no-data) aggregate", async () => {
    adminMock.lakeAlertRule.findMany.mockResolvedValue([
      makeRule({ spec: { metric: "avg", metricField: "attrs.x", windowSeconds: 300 } as unknown as LakeAlertRule["spec"] }),
    ]);
    lakeQueryMock.mockResolvedValue([{ value: null }]);

    const r = await evaluateLakeAlertRules(NOW);

    expect(r).toEqual({ evaluated: 1, fired: 0, resolved: 0 });
    expect(deliverMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastValue: null }) }),
    );
  });

  it("skips rules that are not yet due (no ClickHouse read)", async () => {
    adminMock.lakeAlertRule.findMany.mockResolvedValue([
      makeRule({ lastEvaluatedAt: new Date(NOW.getTime() - 10_000) }),
    ]);

    const r = await evaluateLakeAlertRules(NOW);

    expect(r.evaluated).toBe(0);
    expect(lakeQueryMock).not.toHaveBeenCalled();
  });

  it("no-ops (no rule read) when the lake is disabled", async () => {
    isLakeEnabledMock.mockReturnValue(false);
    const r = await evaluateLakeAlertRules(NOW);
    expect(r).toEqual({ evaluated: 0, fired: 0, resolved: 0 });
    expect(adminMock.lakeAlertRule.findMany).not.toHaveBeenCalled();
  });
});
