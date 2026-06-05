import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type FakeTask = { cron: string; cb: () => Promise<void>; stop: () => void };
  const registered: FakeTask[] = [];
  const cronValidate = vi.fn(
    (expr: string) => /^\S+ \S+ \S+ \S+ \S+$/.test(expr),
  );
  const cronSchedule = vi.fn((expr: string, cb: () => Promise<void>): FakeTask => {
    const t: FakeTask = {
      cron: expr,
      cb,
      stop: () => {},
    };
    registered.push(t);
    return t;
  });
  const findManyOrgs = vi.fn();
  const runCostAnalysis = vi.fn();
  const storeRecommendations = vi.fn();
  const cleanupExpiredRecommendations = vi.fn();
  const generateAiRecommendations = vi.fn();
  return {
    getRegistered: () => registered,
    resetRegistered: () => {
      registered.length = 0;
    },
    cronValidate,
    cronSchedule,
    findManyOrgs,
    runCostAnalysis,
    storeRecommendations,
    cleanupExpiredRecommendations,
    generateAiRecommendations,
  };
});

vi.mock("node-cron", () => ({
  default: { validate: mocks.cronValidate, schedule: mocks.cronSchedule },
  validate: mocks.cronValidate,
  schedule: mocks.cronSchedule,
}));

vi.mock("@/lib/prisma", () => { const __pm = { organization: { findMany: mocks.findManyOrgs } }; return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

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

// (No withOrgTx mock — production code no longer wraps the per-org pipeline
//  in a transaction; see scope-gap comment in cost-optimizer-scheduler.ts.)

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
  });

  it("scheduling registers both global cron tasks (nightly + continuous)", async () => {
    await initCostOptimizerScheduler();
    // Two fleet-global ticks now register: the nightly full pass and the lighter
    // continuous pass. Both fan out across orgs from inside the tick, so they
    // remain global — scheduling never enumerates orgs to build per-org tasks.
    expect(mocks.cronSchedule).toHaveBeenCalledTimes(2);
    expect(mocks.findManyOrgs).not.toHaveBeenCalled();
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
    // The nightly pass is registered first and is the only tick that runs
    // cleanupExpiredRecommendations; invoke it (not the continuous tick).
    await mocks.getRegistered()[0]!.cb();

    // The fan-out invokes the full pipeline once per org. cleanupExpiredRecommendations
    // is the first step of `runDailyCostAnalysisForOrg`, so its call count equals
    // the number of orgs that were iterated.
    expect(mocks.cleanupExpiredRecommendations).toHaveBeenCalledTimes(3);
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
    // Fail on the second org's run (when runCostAnalysis has been called once
    // already and is about to be called for the second time).
    let costAnalysisCalls = 0;
    mocks.runCostAnalysis.mockImplementation(() => {
      costAnalysisCalls++;
      if (costAnalysisCalls === 2) {
        return Promise.reject(new Error("kaboom"));
      }
      return Promise.resolve([]);
    });
    mocks.storeRecommendations.mockResolvedValue({ created: 0, skipped: 0 });

    await runDailyCostAnalysisAllOrgs();

    // cleanupExpiredRecommendations is called BEFORE runCostAnalysis in the
    // pipeline, so even the failing org reaches it. All three orgs are
    // attempted despite the failure on the second.
    expect(mocks.cleanupExpiredRecommendations).toHaveBeenCalledTimes(3);
    expect(costAnalysisCalls).toBe(3);
  });

  it("runDailyCostAnalysisForOrg runs the full pipeline once for one org", async () => {
    mocks.cleanupExpiredRecommendations.mockResolvedValue(2);
    mocks.runCostAnalysis.mockResolvedValue([{ kind: "x" }]);
    mocks.storeRecommendations.mockResolvedValue({ created: 1, skipped: 0 });
    mocks.generateAiRecommendations.mockResolvedValue(0);

    const r = await runDailyCostAnalysisForOrg("org-x");

    expect(mocks.cleanupExpiredRecommendations).toHaveBeenCalledTimes(1);
    expect(mocks.runCostAnalysis).toHaveBeenCalledTimes(1);
    expect(mocks.storeRecommendations).toHaveBeenCalledTimes(1);
    expect(r.expiredCleaned).toBe(2);
    expect(r.analysisCount).toBe(1);
  });
});
