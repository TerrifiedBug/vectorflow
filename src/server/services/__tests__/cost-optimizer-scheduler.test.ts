import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { costRecommendation: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), aggregate: vi.fn() }, pipelineMetric: { groupBy: vi.fn() }, pipeline: { findMany: vi.fn() }, pipelineNode: { findMany: vi.fn() } },
}));
vi.mock("@/lib/logger", () => ({ debugLog: vi.fn() }));
vi.mock("@/server/services/cost-optimizer", () => ({
  runCostAnalysis: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/server/services/cost-recommendations", () => ({
  storeRecommendations: vi.fn().mockResolvedValue({ created: 0, skipped: 0 }),
  cleanupExpiredRecommendations: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/server/services/cost-optimizer-ai", () => ({
  generateAiRecommendations: vi.fn().mockResolvedValue(0),
}));

import { runDailyCostAnalysis } from "@/server/services/cost-optimizer-scheduler";
import { runCostAnalysis } from "@/server/services/cost-optimizer";
import { storeRecommendations, cleanupExpiredRecommendations } from "@/server/services/cost-recommendations";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runDailyCostAnalysis", () => {
  it("runs cleanup, analysis, storage, and AI enrichment in order", async () => {
    const result = await runDailyCostAnalysis();

    expect(cleanupExpiredRecommendations).toHaveBeenCalledTimes(1);
    expect(runCostAnalysis).toHaveBeenCalledTimes(1);
    expect(storeRecommendations).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      analysisCount: 0,
      created: 0,
      skipped: 0,
      aiEnriched: 0,
      expiredCleaned: 0,
    });
  });

  it("returns correct counts when recommendations are found", async () => {
    const mockResults = [
      { pipelineId: "p1", type: "LOW_REDUCTION", title: "t", description: "d", analysisData: {}, estimatedSavingsBytes: null, suggestedAction: null, pipelineName: "n", environmentId: "e", teamId: "t" },
    ];
    vi.mocked(runCostAnalysis).mockResolvedValueOnce(mockResults as never);
    vi.mocked(storeRecommendations).mockResolvedValueOnce({ created: 1, skipped: 0 });

    const result = await runDailyCostAnalysis();

    expect(result.analysisCount).toBe(1);
    expect(result.created).toBe(1);
  });
});
