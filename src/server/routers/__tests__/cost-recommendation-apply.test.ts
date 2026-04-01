import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));
vi.mock("@/lib/logger", () => ({ debugLog: vi.fn(), errorLog: vi.fn() }));
vi.mock("@/server/services/pipeline-version", () => ({
  createVersion: vi.fn(),
}));
vi.mock("@/server/services/cost-optimizer-apply", () => ({
  applyRecommendationToYaml: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { createVersion } from "@/server/services/pipeline-version";
import { applyRecommendationToYaml } from "@/server/services/cost-optimizer-apply";
import {
  previewRecommendation,
  applyRecommendation,
} from "@/server/services/cost-recommendation-procedures";

const prismaMock = prisma as unknown as ReturnType<typeof mockDeep<PrismaClient>>;
const createVersionMock = createVersion as ReturnType<typeof vi.fn>;
const applyYamlMock = applyRecommendationToYaml as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockReset(prismaMock);
  vi.clearAllMocks();
});

const SAMPLE_YAML = `sources:
  my_source:
    type: demo_logs
sinks:
  my_sink:
    type: console
    inputs:
      - my_source
`;

const PROPOSED_YAML = `sources:
  my_source:
    type: demo_logs
transforms:
  cost_sampler:
    type: sample
    inputs:
      - my_source
    rate: 10
sinks:
  my_sink:
    type: console
    inputs:
      - cost_sampler
`;

function makeRecommendation(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    pipelineId: "pipe-1",
    environmentId: "env-1",
    teamId: "team-1",
    status: "PENDING",
    title: "Sample high-volume logs",
    description: "Add sampling to reduce volume",
    suggestedAction: {
      type: "add_sampling",
      config: { rate: 10, componentKey: "cost_sampler" },
    },
    analysisData: { targetSinkKey: "my_sink" },
    pipeline: {
      id: "pipe-1",
      name: "Test Pipeline",
    },
    ...overrides,
  };
}

describe("previewRecommendation", () => {
  it("returns YAML diff for structured actions", async () => {
    prismaMock.costRecommendation.findUnique.mockResolvedValue(
      makeRecommendation() as never,
    );
    prismaMock.pipelineVersion.findFirst.mockResolvedValue({
      id: "ver-1",
      configYaml: SAMPLE_YAML,
      version: 1,
    } as never);
    applyYamlMock.mockReturnValue(PROPOSED_YAML);

    const result = await previewRecommendation("rec-1");

    expect(result.currentYaml).toBe(SAMPLE_YAML);
    expect(result.proposedYaml).toBe(PROPOSED_YAML);
    expect(result.diff).toBeDefined();
    expect(result.diff).toContain("+");
    expect(result.recommendation.id).toBe("rec-1");
  });

  it("returns isDisable for disable_pipeline actions", async () => {
    prismaMock.costRecommendation.findUnique.mockResolvedValue(
      makeRecommendation({
        suggestedAction: {
          type: "disable_pipeline",
          config: {},
        },
      }) as never,
    );

    const result = await previewRecommendation("rec-1");

    expect(result.isDisable).toBe(true);
    expect(result.recommendation.id).toBe("rec-1");
  });

  it("throws NOT_FOUND for missing recommendation", async () => {
    prismaMock.costRecommendation.findUnique.mockResolvedValue(null);

    await expect(previewRecommendation("rec-missing")).rejects.toThrow(
      "Recommendation not found",
    );
  });

  it("throws BAD_REQUEST when suggestedAction is null", async () => {
    prismaMock.costRecommendation.findUnique.mockResolvedValue(
      makeRecommendation({ suggestedAction: null }) as never,
    );

    await expect(previewRecommendation("rec-1")).rejects.toThrow(
      "No suggested action",
    );
  });
});

describe("applyRecommendation", () => {
  it("creates a new version and marks recommendation as APPLIED", async () => {
    prismaMock.costRecommendation.findUnique.mockResolvedValue(
      makeRecommendation() as never,
    );
    prismaMock.pipelineVersion.findFirst.mockResolvedValue({
      id: "ver-1",
      configYaml: SAMPLE_YAML,
      version: 1,
    } as never);
    applyYamlMock.mockReturnValue(PROPOSED_YAML);
    createVersionMock.mockResolvedValue({
      id: "ver-2",
      version: 2,
      pipelineId: "pipe-1",
    });
    prismaMock.costRecommendation.update.mockResolvedValue({
      id: "rec-1",
      status: "APPLIED",
    } as never);

    const result = await applyRecommendation("rec-1", "user-1");

    expect(result.success).toBe(true);
    expect(result.pipelineId).toBe("pipe-1");
    expect(result.pipelineName).toBe("Test Pipeline");
    expect(result.versionNumber).toBe(2);
    expect(createVersionMock).toHaveBeenCalledWith(
      "pipe-1",
      PROPOSED_YAML,
      "user-1",
      expect.stringContaining("cost recommendation"),
    );
    expect(prismaMock.costRecommendation.update).toHaveBeenCalledWith({
      where: { id: "rec-1" },
      data: { status: "APPLIED", appliedAt: expect.any(Date) },
    });
  });

  it("disables pipeline for disable_pipeline actions", async () => {
    prismaMock.costRecommendation.findUnique.mockResolvedValue(
      makeRecommendation({
        suggestedAction: {
          type: "disable_pipeline",
          config: {},
        },
      }) as never,
    );
    prismaMock.pipeline.update.mockResolvedValue({
      id: "pipe-1",
      name: "Test Pipeline",
    } as never);
    prismaMock.costRecommendation.update.mockResolvedValue({
      id: "rec-1",
      status: "APPLIED",
    } as never);

    const result = await applyRecommendation("rec-1", "user-1");

    expect(result.success).toBe(true);
    expect(result.versionNumber).toBe(0);
    expect(prismaMock.pipeline.update).toHaveBeenCalledWith({
      where: { id: "pipe-1" },
      data: { isDraft: true },
    });
  });

  it("rejects non-PENDING recommendations", async () => {
    prismaMock.costRecommendation.findUnique.mockResolvedValue(
      makeRecommendation({ status: "DISMISSED" }) as never,
    );

    await expect(
      applyRecommendation("rec-1", "user-1"),
    ).rejects.toThrow("only be applied when PENDING");
  });

  it("throws NOT_FOUND for missing recommendation", async () => {
    prismaMock.costRecommendation.findUnique.mockResolvedValue(null);

    await expect(
      applyRecommendation("rec-missing", "user-1"),
    ).rejects.toThrow("Recommendation not found");
  });
});
