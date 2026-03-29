import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import type { AnalysisResult } from "@/server/services/cost-optimizer-types";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));
vi.mock("@/lib/logger", () => ({ debugLog: vi.fn() }));

import { prisma } from "@/lib/prisma";
import {
  storeRecommendations,
  cleanupExpiredRecommendations,
  dismissRecommendation,
  markRecommendationApplied,
} from "@/server/services/cost-recommendations";

const prismaMock = prisma as unknown as ReturnType<typeof mockDeep<PrismaClient>>;

beforeEach(() => {
  mockReset(prismaMock);
});

function makeResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    pipelineId: "pipe-1",
    pipelineName: "test-pipeline",
    environmentId: "env-1",
    teamId: "team-1",
    type: "LOW_REDUCTION",
    title: "Test recommendation",
    description: "Test description",
    analysisData: { bytesIn: "1000000000" },
    estimatedSavingsBytes: BigInt(200_000_000),
    suggestedAction: null,
    ...overrides,
  };
}

describe("storeRecommendations", () => {
  it("creates recommendations for new analysis results", async () => {
    prismaMock.costRecommendation.findMany.mockResolvedValue([]);
    prismaMock.costRecommendation.create.mockResolvedValue({} as never);

    const results = [makeResult()];
    const { created, skipped } = await storeRecommendations(results);

    expect(created).toBe(1);
    expect(skipped).toBe(0);
    expect(prismaMock.costRecommendation.create).toHaveBeenCalledTimes(1);
  });

  it("skips duplicate recommendations for same pipeline+type", async () => {
    prismaMock.costRecommendation.findMany.mockResolvedValue([
      { pipelineId: "pipe-1", type: "LOW_REDUCTION" },
    ] as never);

    const results = [makeResult()];
    const { created, skipped } = await storeRecommendations(results);

    expect(created).toBe(0);
    expect(skipped).toBe(1);
    expect(prismaMock.costRecommendation.create).not.toHaveBeenCalled();
  });

  it("creates different types for the same pipeline", async () => {
    prismaMock.costRecommendation.findMany.mockResolvedValue([]);
    prismaMock.costRecommendation.create.mockResolvedValue({} as never);

    const results = [
      makeResult({ type: "LOW_REDUCTION" }),
      makeResult({ type: "HIGH_ERROR_RATE" }),
    ];
    const { created, skipped } = await storeRecommendations(results);

    expect(created).toBe(2);
    expect(skipped).toBe(0);
  });
});

describe("cleanupExpiredRecommendations", () => {
  it("deletes expired recommendations", async () => {
    prismaMock.costRecommendation.deleteMany.mockResolvedValue({ count: 5 });

    const count = await cleanupExpiredRecommendations();
    expect(count).toBe(5);
    expect(prismaMock.costRecommendation.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
  });
});

describe("dismissRecommendation", () => {
  it("updates status and sets dismissal metadata", async () => {
    prismaMock.costRecommendation.update.mockResolvedValue({} as never);

    await dismissRecommendation("rec-1", "user-1");

    expect(prismaMock.costRecommendation.update).toHaveBeenCalledWith({
      where: { id: "rec-1" },
      data: {
        status: "DISMISSED",
        dismissedById: "user-1",
        dismissedAt: expect.any(Date),
      },
    });
  });
});

describe("markRecommendationApplied", () => {
  it("updates status to APPLIED with timestamp", async () => {
    prismaMock.costRecommendation.update.mockResolvedValue({} as never);

    await markRecommendationApplied("rec-1");

    expect(prismaMock.costRecommendation.update).toHaveBeenCalledWith({
      where: { id: "rec-1" },
      data: {
        status: "APPLIED",
        appliedAt: expect.any(Date),
      },
    });
  });
});
