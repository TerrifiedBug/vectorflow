import { describe, it, expect } from "vitest";
import { Prisma } from "@/generated/prisma";

describe("CostRecommendation migration", () => {
  it("CostRecommendation model exists in Prisma client", () => {
    // Verify the model delegate exists via Prisma namespace
    expect(Prisma.CostRecommendationScalarFieldEnum).toBeDefined();
    expect(Prisma.CostRecommendationScalarFieldEnum.id).toBe("id");
    expect(Prisma.CostRecommendationScalarFieldEnum.teamId).toBe("teamId");
    expect(Prisma.CostRecommendationScalarFieldEnum.type).toBe("type");
    expect(Prisma.CostRecommendationScalarFieldEnum.status).toBe("status");
  });
});
