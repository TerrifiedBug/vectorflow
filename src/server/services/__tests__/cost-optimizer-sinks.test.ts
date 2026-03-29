import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import { detectDuplicateSinks } from "@/server/services/cost-optimizer";

const prismaMock = prisma as unknown as ReturnType<typeof mockDeep<PrismaClient>>;

beforeEach(() => {
  mockReset(prismaMock);
});

describe("detectDuplicateSinks", () => {
  it("detects two pipelines writing to the same elasticsearch endpoint", async () => {
    prismaMock.pipelineNode.findMany.mockResolvedValue([
      {
        componentKey: "es_sink_1",
        componentType: "elasticsearch",
        config: { endpoint: "https://es.example.com", index: "logs-prod" },
        pipeline: {
          id: "pipe-1",
          name: "Pipeline A",
          environmentId: "env-1",
          environment: { teamId: "team-1" },
        },
      },
      {
        componentKey: "es_sink_2",
        componentType: "elasticsearch",
        config: { endpoint: "https://es.example.com", index: "logs-prod" },
        pipeline: {
          id: "pipe-2",
          name: "Pipeline B",
          environmentId: "env-1",
          environment: { teamId: "team-1" },
        },
      },
    ] as never);

    const results = await detectDuplicateSinks();
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("DUPLICATE_SINK");
    expect(results[0].pipelineId).toBe("pipe-2");
    expect(results[0].analysisData).toHaveProperty("duplicateOf", "pipe-1");
  });

  it("does not flag sinks writing to different endpoints", async () => {
    prismaMock.pipelineNode.findMany.mockResolvedValue([
      {
        componentKey: "es_sink_1",
        componentType: "elasticsearch",
        config: { endpoint: "https://es-1.example.com", index: "logs" },
        pipeline: {
          id: "pipe-1",
          name: "Pipeline A",
          environmentId: "env-1",
          environment: { teamId: "team-1" },
        },
      },
      {
        componentKey: "es_sink_2",
        componentType: "elasticsearch",
        config: { endpoint: "https://es-2.example.com", index: "logs" },
        pipeline: {
          id: "pipe-2",
          name: "Pipeline B",
          environmentId: "env-1",
          environment: { teamId: "team-1" },
        },
      },
    ] as never);

    const results = await detectDuplicateSinks();
    expect(results).toHaveLength(0);
  });

  it("does not flag sinks across different environments", async () => {
    prismaMock.pipelineNode.findMany.mockResolvedValue([
      {
        componentKey: "es_sink_1",
        componentType: "elasticsearch",
        config: { endpoint: "https://es.example.com", index: "logs" },
        pipeline: {
          id: "pipe-1",
          name: "Pipeline A",
          environmentId: "env-1",
          environment: { teamId: "team-1" },
        },
      },
      {
        componentKey: "es_sink_2",
        componentType: "elasticsearch",
        config: { endpoint: "https://es.example.com", index: "logs" },
        pipeline: {
          id: "pipe-2",
          name: "Pipeline B",
          environmentId: "env-2",       // different environment
          environment: { teamId: "team-1" },
        },
      },
    ] as never);

    const results = await detectDuplicateSinks();
    expect(results).toHaveLength(0);
  });
});
