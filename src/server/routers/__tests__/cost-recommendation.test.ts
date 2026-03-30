import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));
vi.mock("@/lib/logger", () => ({ debugLog: vi.fn() }));

import { prisma } from "@/lib/prisma";
import {
  listRecommendations,
  dismissRecommendation,
  markRecommendationApplied,
} from "@/server/services/cost-recommendations";

const prismaMock = prisma as unknown as ReturnType<typeof mockDeep<PrismaClient>>;

beforeEach(() => {
  mockReset(prismaMock);
});

describe("cost-recommendation service integration", () => {
  it("listRecommendations filters by environmentId and status", async () => {
    prismaMock.costRecommendation.findMany.mockResolvedValue([]);

    const results = await listRecommendations({
      environmentId: "env-1",
      status: "PENDING",
    });

    expect(results).toEqual([]);
    expect(prismaMock.costRecommendation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          environmentId: "env-1",
          status: "PENDING",
        }),
      }),
    );
  });

  it("dismissRecommendation sets status and metadata", async () => {
    prismaMock.costRecommendation.update.mockResolvedValue({
      id: "rec-1",
      status: "DISMISSED",
    } as never);

    const result = await dismissRecommendation("rec-1", "user-1");
    expect(result.status).toBe("DISMISSED");
  });

  it("markRecommendationApplied sets APPLIED status", async () => {
    prismaMock.costRecommendation.update.mockResolvedValue({
      id: "rec-1",
      status: "APPLIED",
    } as never);

    const result = await markRecommendationApplied("rec-1");
    expect(result.status).toBe("APPLIED");
  });
});
