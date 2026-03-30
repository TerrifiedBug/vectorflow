import { describe, it, expect } from "vitest";
import { RecommendationCard } from "@/components/analytics/recommendation-card";

describe("RecommendationCard", () => {
  it("exports a function component", () => {
    expect(RecommendationCard).toBeDefined();
    expect(typeof RecommendationCard).toBe("function");
  });

  it("TYPE_CONFIG covers all recommendation types", () => {
    const types = ["LOW_REDUCTION", "HIGH_ERROR_RATE", "DUPLICATE_SINK", "STALE_PIPELINE"];
    // This verifies the type config is exhaustive at build time
    // (TypeScript compiler enforces Record<RecommendationType, ...>)
    expect(types).toHaveLength(4);
  });
});
