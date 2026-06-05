import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => {
  const __pm = mockDeep<PrismaClient>();
  return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
});
vi.mock("@/lib/logger", () => ({ debugLog: vi.fn(), infoLog: vi.fn(), errorLog: vi.fn() }));
// evaluateVrl shells out to the `vector` binary; mock it so the simulator is
// deterministic and we can assert the stats are passed through unchanged.
vi.mock("@/server/services/transform-eval", () => ({ evaluateVrl: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { evaluateVrl } from "@/server/services/transform-eval";
import { simulateTransform } from "@/server/services/cost-recommendation-procedures";
import { enrichRecommendationsWithCost } from "@/server/services/cost-recommendations";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const GIB = 1_073_741_824;

const EVAL_RESULT = {
  outputs: [{ a: 1 }],
  inputCount: 4,
  outputCount: 1,
  droppedCount: 3,
  inputBytes: 400,
  outputBytes: 100,
  eventReductionPercent: 75,
  byteReductionPercent: 75,
  durationMs: 1,
};

beforeEach(() => {
  mockReset(prismaMock);
  vi.clearAllMocks();
});

describe("simulateTransform", () => {
  it("runs evaluateVrl against the pipeline's events and returns its reduction stats + projected $", async () => {
    prismaMock.costRecommendation.findUnique.mockResolvedValue({
      environmentId: "env-1",
      pipelineId: "p1",
      suggestedAction: {
        type: "drop_field",
        config: { fields: ["req_id"], componentKey: "drop_x" },
      },
    } as never);
    prismaMock.tapCapture.findFirst.mockResolvedValue({
      events: [{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }],
    } as never);
    vi.mocked(evaluateVrl).mockResolvedValue(EVAL_RESULT as never);

    // $ projection inputs: priced sink + 4 GiB recent bytesOut baseline.
    prismaMock.destinationCostModel.findMany.mockResolvedValue([
      { sinkType: "datadog_logs", label: null, pricePerGbCents: 250 },
    ] as never);
    prismaMock.pipelineNode.findMany.mockResolvedValue([
      { pipelineId: "p1", componentType: "datadog_logs", componentKey: "dd" },
    ] as never);
    prismaMock.pipelineMetric.aggregate.mockResolvedValue({
      _sum: { bytesOut: BigInt(4 * GIB) },
    } as never);

    const result = await simulateTransform({
      environmentId: "env-1",
      organizationId: "org-1",
      recommendationId: "rec-1",
    });

    // Reduction matches evaluateVrl exactly.
    expect(result.skipped).toBe(false);
    expect(result.eventReductionPercent).toBe(75);
    expect(result.byteReductionPercent).toBe(75);
    expect(result.droppedCount).toBe(3);
    expect(result.inputCount).toBe(4);
    expect(result.outputCount).toBe(1);

    // Derived VRL for drop_field uses a quoted VRL path.
    expect(result.source).toBe('del(."req_id")');
    expect(vi.mocked(evaluateVrl)).toHaveBeenCalledTimes(1);
    const [calledSource, calledEvents] = vi.mocked(evaluateVrl).mock.calls[0];
    expect(calledSource).toBe('del(."req_id")');
    expect(calledEvents).toHaveLength(4);

    // 75% of 4 GiB = 3 GiB saved; 3 GiB * 250 cents/GB = 750.
    expect(result.estimatedSavingsCents).toBe(750);
  });

  it("skips cleanly (no evaluateVrl call) when there is no event sample", async () => {
    prismaMock.costRecommendation.findUnique.mockResolvedValue({
      environmentId: "env-1",
      pipelineId: "p1",
      suggestedAction: { type: "drop_field", config: { fields: ["req_id"], componentKey: "d" } },
    } as never);
    prismaMock.tapCapture.findFirst.mockResolvedValue(null as never);
    prismaMock.eventSample.findFirst.mockResolvedValue(null as never);

    const result = await simulateTransform({
      environmentId: "env-1",
      organizationId: "org-1",
      recommendationId: "rec-1",
    });

    expect(result.skipped).toBe(true);
    expect(result.estimatedSavingsCents).toBeNull();
    expect(vi.mocked(evaluateVrl)).not.toHaveBeenCalled();
  });

  it("simulates caller-supplied VRL and omits $ when no cost model is configured", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({ environmentId: "env-1" } as never);
    prismaMock.tapCapture.findFirst.mockResolvedValue({
      events: [{ x: 1 }, { x: 2 }],
    } as never);
    vi.mocked(evaluateVrl).mockResolvedValue(EVAL_RESULT as never);
    // No price models for the org → byte-only.
    prismaMock.destinationCostModel.findMany.mockResolvedValue([] as never);

    const result = await simulateTransform({
      environmentId: "env-1",
      organizationId: "org-1",
      pipelineId: "p1",
      vrl: "abort",
    });

    expect(result.skipped).toBe(false);
    expect(result.source).toBe("abort");
    expect(result.byteReductionPercent).toBe(75);
    expect(result.estimatedSavingsCents).toBeNull();
    // No model means we never need to resolve sink types or baseline volume.
    expect(prismaMock.pipelineNode.findMany).not.toHaveBeenCalled();
  });

  it("rejects a cross-env recommendation", async () => {
    prismaMock.costRecommendation.findUnique.mockResolvedValue({
      environmentId: "env-OTHER",
      pipelineId: "p1",
      suggestedAction: null,
    } as never);

    await expect(
      simulateTransform({ environmentId: "env-1", organizationId: "org-1", recommendationId: "rec-1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires a pipelineId+vrl when no recommendationId is given", async () => {
    await expect(
      simulateTransform({ environmentId: "env-1", organizationId: "org-1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("enrichRecommendationsWithCost", () => {
  it("projects $ savings from the sink's price model", async () => {
    prismaMock.destinationCostModel.findMany.mockResolvedValue([
      { sinkType: "datadog_logs", label: null, pricePerGbCents: 250 },
    ] as never);
    prismaMock.pipelineNode.findMany.mockResolvedValue([
      { pipelineId: "p1", componentType: "datadog_logs", componentKey: "dd" },
    ] as never);

    const enriched = await enrichRecommendationsWithCost(
      [{ pipelineId: "p1", estimatedSavingsBytes: BigInt(2 * GIB) }],
      "org-1",
    );

    expect(enriched[0].estimatedSavingsCents).toBe(500); // 2 GiB * 250
  });

  it("returns null cents (byte-only) and skips the sink lookup when no models are configured", async () => {
    prismaMock.destinationCostModel.findMany.mockResolvedValue([] as never);

    const enriched = await enrichRecommendationsWithCost(
      [{ pipelineId: "p1", estimatedSavingsBytes: BigInt(2 * GIB) }],
      "org-1",
    );

    expect(enriched[0].estimatedSavingsCents).toBeNull();
    expect(prismaMock.pipelineNode.findMany).not.toHaveBeenCalled();
  });

  it("returns null cents when the rec has no byte estimate", async () => {
    prismaMock.destinationCostModel.findMany.mockResolvedValue([
      { sinkType: "datadog_logs", label: null, pricePerGbCents: 250 },
    ] as never);
    prismaMock.pipelineNode.findMany.mockResolvedValue([
      { pipelineId: "p1", componentType: "datadog_logs", componentKey: "dd" },
    ] as never);

    const enriched = await enrichRecommendationsWithCost(
      [{ pipelineId: "p1", estimatedSavingsBytes: null }],
      "org-1",
    );

    expect(enriched[0].estimatedSavingsCents).toBeNull();
  });
});
