import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));
vi.mock("@/lib/logger", () => ({ debugLog: vi.fn(), errorLog: vi.fn() }));

const mockGetTeamAiConfig = vi.fn();
vi.mock("@/server/services/ai", () => ({
  getTeamAiConfig: (...args: unknown[]) => mockGetTeamAiConfig(...args),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { prisma } from "@/lib/prisma";
import { generateAiRecommendations } from "@/server/services/cost-optimizer-ai";

const prismaMock = prisma as unknown as ReturnType<typeof mockDeep<PrismaClient>>;

beforeEach(() => {
  mockReset(prismaMock);
  mockGetTeamAiConfig.mockReset();
  mockFetch.mockReset();
});

describe("generateAiRecommendations", () => {
  it("returns 0 when no recommendations need enrichment", async () => {
    prismaMock.costRecommendation.findMany.mockResolvedValue([]);

    const count = await generateAiRecommendations();
    expect(count).toBe(0);
  });

  it("enriches recommendations with AI summaries", async () => {
    prismaMock.costRecommendation.findMany.mockResolvedValue([
      {
        id: "rec-1",
        teamId: "team-1",
        type: "LOW_REDUCTION",
        title: "Low reduction",
        description: "Pipeline has minimal reduction",
        analysisData: { bytesIn: "10000000000" },
        suggestedAction: null,
        pipeline: { name: "My Pipeline", nodes: [] },
      },
    ] as never);

    mockGetTeamAiConfig.mockResolvedValue({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-4o",
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Add a sampling transform at 80% to reduce volume." } }],
      }),
    });

    prismaMock.costRecommendation.update.mockResolvedValue({} as never);

    const count = await generateAiRecommendations();
    expect(count).toBe(1);

    expect(prismaMock.costRecommendation.update).toHaveBeenCalledWith({
      where: { id: "rec-1" },
      data: { aiSummary: "Add a sampling transform at 80% to reduce volume." },
    });
  });

  it("skips teams without AI configured", async () => {
    prismaMock.costRecommendation.findMany.mockResolvedValue([
      {
        id: "rec-1",
        teamId: "team-no-ai",
        type: "LOW_REDUCTION",
        title: "Low reduction",
        description: "desc",
        analysisData: {},
        suggestedAction: null,
        pipeline: { name: "Pipeline" },
      },
    ] as never);

    mockGetTeamAiConfig.mockRejectedValue(new Error("AI not configured"));

    const count = await generateAiRecommendations();
    expect(count).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("continues processing other recommendations when one AI call fails", async () => {
    prismaMock.costRecommendation.findMany.mockResolvedValue([
      {
        id: "rec-1",
        teamId: "team-1",
        type: "LOW_REDUCTION",
        title: "Rec 1",
        description: "desc",
        analysisData: {},
        suggestedAction: null,
        pipeline: { name: "Pipeline A", nodes: [] },
      },
      {
        id: "rec-2",
        teamId: "team-1",
        type: "HIGH_ERROR_RATE",
        title: "Rec 2",
        description: "desc",
        analysisData: {},
        suggestedAction: null,
        pipeline: { name: "Pipeline B", nodes: [] },
      },
    ] as never);

    mockGetTeamAiConfig.mockResolvedValue({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-4o",
    });

    mockFetch
      .mockResolvedValueOnce({ ok: false, text: async () => "Rate limited" })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Fix the errors." } }],
        }),
      });

    prismaMock.costRecommendation.update.mockResolvedValue({} as never);

    const count = await generateAiRecommendations();
    expect(count).toBe(1); // only second succeeded
  });
});
