import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type FakeTask = { cron: string; cb: () => Promise<void>; stop: () => void };
  let registered: FakeTask | null = null;
  const cronValidate = vi.fn(
    (expr: string) => /^\S+ \S+ \S+ \S+ \S+$/.test(expr),
  );
  const cronSchedule = vi.fn((expr: string, cb: () => Promise<void>): FakeTask => {
    const t: FakeTask = {
      cron: expr,
      cb,
      stop: () => {},
    };
    registered = t;
    return t;
  });
  const findManyOrgs = vi.fn();
  const runCostAnalysis = vi.fn();
  const storeRecommendations = vi.fn();
  const cleanupExpiredRecommendations = vi.fn();
  const generateAiRecommendations = vi.fn();
  const withOrgTxCalls: string[] = [];
  return {
    getRegistered: () => registered,
    resetRegistered: () => {
      registered = null;
    },
    cronValidate,
    cronSchedule,
    findManyOrgs,
    runCostAnalysis,
    storeRecommendations,
    cleanupExpiredRecommendations,
    generateAiRecommendations,
    withOrgTxCalls,
  };
});

vi.mock("node-cron", () => ({
  default: { validate: mocks.cronValidate, schedule: mocks.cronSchedule },
  validate: mocks.cronValidate,
  schedule: mocks.cronSchedule,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { organization: { findMany: mocks.findManyOrgs } },
}));

vi.mock("@/server/services/cost-optimizer", () => ({
  runCostAnalysis: mocks.runCostAnalysis,
}));
vi.mock("@/server/services/cost-recommendations", () => ({
  storeRecommendations: mocks.storeRecommendations,
  cleanupExpiredRecommendations: mocks.cleanupExpiredRecommendations,
}));
vi.mock("@/server/services/cost-optimizer-ai", () => ({
  generateAiRecommendations: mocks.generateAiRecommendations,
}));

vi.mock("@/lib/with-org-tx", () => ({
  withOrgTx: async <T>(orgId: string, fn: (tx: unknown) => Promise<T>) => {
    mocks.withOrgTxCalls.push(orgId);
    return fn({});
  },
}));

import {
  initCostOptimizerScheduler,
  runDailyCostAnalysisForOrg,
  runDailyCostAnalysisAllOrgs,
} from "../cost-optimizer-scheduler";

describe("cost-optimizer-scheduler — per-org iteration", () => {
  beforeEach(() => {
    mocks.resetRegistered();
    mocks.cronValidate.mockClear();
    mocks.cronSchedule.mockClear();
    mocks.findManyOrgs.mockReset();
    mocks.runCostAnalysis.mockReset();
    mocks.storeRecommendations.mockReset();
    mocks.cleanupExpiredRecommendations.mockReset();
    mocks.generateAiRecommendations.mockReset();
    mocks.withOrgTxCalls.length = 0;
  });

  it("scheduling registers a single global cron task", async () => {
    await initCostOptimizerScheduler();
    expect(mocks.cronSchedule).toHaveBeenCalledTimes(1);
  });

  it("the registered tick fans out across all non-suspended, non-deleted orgs", async () => {
    mocks.findManyOrgs.mockResolvedValue([
      { id: "org-a" },
      { id: "org-b" },
      { id: "org-c" },
    ]);
    mocks.cleanupExpiredRecommendations.mockResolvedValue(0);
    mocks.runCostAnalysis.mockResolvedValue([]);
    mocks.storeRecommendations.mockResolvedValue({ created: 0, skipped: 0 });

    await initCostOptimizerScheduler();
    await mocks.getRegistered()!.cb();

    expect(mocks.withOrgTxCalls).toEqual(["org-a", "org-b", "org-c"]);
    const findManyArgs = mocks.findManyOrgs.mock.calls[0][0];
    expect(findManyArgs.where.suspendedAt).toBe(null);
    expect(findManyArgs.where.deletedAt).toBe(null);
  });

  it("a per-org failure does NOT abort the remaining orgs (best-effort)", async () => {
    mocks.findManyOrgs.mockResolvedValue([
      { id: "org-a" },
      { id: "org-b" },
      { id: "org-c" },
    ]);
    mocks.cleanupExpiredRecommendations.mockResolvedValue(0);
    mocks.runCostAnalysis.mockImplementation(() => {
      // Fail on the second org's run; others should still execute.
      if (mocks.withOrgTxCalls.length === 2) {
        return Promise.reject(new Error("kaboom"));
      }
      return Promise.resolve([]);
    });
    mocks.storeRecommendations.mockResolvedValue({ created: 0, skipped: 0 });

    await runDailyCostAnalysisAllOrgs();

    // We attempted withOrgTx for all three orgs even though one failed.
    expect(mocks.withOrgTxCalls).toEqual(["org-a", "org-b", "org-c"]);
  });

  it("runDailyCostAnalysisForOrg runs the full pipeline once for one org", async () => {
    mocks.cleanupExpiredRecommendations.mockResolvedValue(2);
    mocks.runCostAnalysis.mockResolvedValue([{ kind: "x" }]);
    mocks.storeRecommendations.mockResolvedValue({ created: 1, skipped: 0 });
    mocks.generateAiRecommendations.mockResolvedValue(0);

    const r = await runDailyCostAnalysisForOrg("org-x");

    expect(mocks.withOrgTxCalls).toEqual(["org-x"]);
    expect(mocks.cleanupExpiredRecommendations).toHaveBeenCalledTimes(1);
    expect(mocks.runCostAnalysis).toHaveBeenCalledTimes(1);
    expect(mocks.storeRecommendations).toHaveBeenCalledTimes(1);
    expect(r.expiredCleaned).toBe(2);
    expect(r.analysisCount).toBe(1);
  });
});
