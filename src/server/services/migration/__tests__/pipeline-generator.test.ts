import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TranslationResult } from "../types";

// Mock Prisma
const mockPrismaCreate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    pipeline: {
      create: (...args: unknown[]) => mockPrismaCreate(...args),
    },
  },
}));

// Mock nanoid
vi.mock("nanoid", () => ({
  nanoid: vi.fn().mockImplementation(() => `id_${Math.random().toString(36).slice(2, 8)}`),
}));

import { generatePipeline } from "../pipeline-generator";

describe("generatePipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaCreate.mockResolvedValue({ id: "pipeline-123" });
  });

  it("creates a pipeline with nodes and edges from translated blocks", async () => {
    const translationResult: TranslationResult = {
      blocks: [
        {
          blockId: "b1",
          componentType: "file",
          componentId: "nginx_logs",
          kind: "source",
          config: { include: ["/var/log/nginx/access.log"] },
          inputs: [],
          confidence: 90,
          notes: [],
          validationErrors: [],
          status: "translated",
        },
        {
          blockId: "b2",
          componentType: "remap",
          componentId: "parse_json",
          kind: "transform",
          config: { source: '. = parse_json!(.message)' },
          inputs: ["nginx_logs"],
          confidence: 85,
          notes: [],
          validationErrors: [],
          status: "translated",
        },
        {
          blockId: "b3",
          componentType: "elasticsearch",
          componentId: "es_output",
          kind: "sink",
          config: { endpoints: ["http://es-host:9200"] },
          inputs: ["parse_json"],
          confidence: 88,
          notes: [],
          validationErrors: [],
          status: "translated",
        },
      ],
      vectorYaml: "sources: ...",
      overallConfidence: 87,
      warnings: [],
    };

    const result = await generatePipeline({
      translationResult,
      environmentId: "env-123",
      pipelineName: "Migrated FluentD Pipeline",
      migrationProjectId: "mig-123",
    });

    expect(result.id).toBe("pipeline-123");
    expect(mockPrismaCreate).toHaveBeenCalledTimes(1);

    const createCall = mockPrismaCreate.mock.calls[0][0];
    expect(createCall.data.name).toBe("Migrated FluentD Pipeline");
    expect(createCall.data.environmentId).toBe("env-123");
    expect(createCall.data.isDraft).toBe(true);

    // Verify nodes
    const nodes = createCall.data.nodes.create;
    expect(nodes).toHaveLength(3);
    expect(nodes.find((n: Record<string, unknown>) => n.componentKey === "nginx_logs")).toBeDefined();
    expect(nodes.find((n: Record<string, unknown>) => n.componentKey === "parse_json")).toBeDefined();
    expect(nodes.find((n: Record<string, unknown>) => n.componentKey === "es_output")).toBeDefined();

    // Verify edges (should have 2 edges: source->transform, transform->sink)
    const edges = createCall.data.edges.create;
    expect(edges).toHaveLength(2);
  });

  it("skips failed blocks when generating pipeline", async () => {
    const translationResult: TranslationResult = {
      blocks: [
        {
          blockId: "b1",
          componentType: "file",
          componentId: "source_1",
          kind: "source",
          config: { include: ["/var/log/app.log"] },
          inputs: [],
          confidence: 90,
          notes: [],
          validationErrors: [],
          status: "translated",
        },
        {
          blockId: "b2",
          componentType: "unknown",
          componentId: "failed_transform",
          kind: "transform",
          config: {},
          inputs: [],
          confidence: 0,
          notes: ["Translation failed"],
          validationErrors: [],
          status: "failed",
        },
        {
          blockId: "b3",
          componentType: "console",
          componentId: "console_out",
          kind: "sink",
          config: {},
          inputs: ["source_1"],
          confidence: 95,
          notes: [],
          validationErrors: [],
          status: "translated",
        },
      ],
      vectorYaml: "",
      overallConfidence: 50,
      warnings: [],
    };

    await generatePipeline({
      translationResult,
      environmentId: "env-123",
      pipelineName: "Test Pipeline",
      migrationProjectId: "mig-123",
    });

    const createCall = mockPrismaCreate.mock.calls[0][0];
    const nodes = createCall.data.nodes.create;

    // Failed block should be excluded
    expect(nodes).toHaveLength(2);
    expect(nodes.find((n: Record<string, unknown>) => n.componentKey === "failed_transform")).toBeUndefined();
  });

  it("throws when no successful blocks exist", async () => {
    const translationResult: TranslationResult = {
      blocks: [
        {
          blockId: "b1",
          componentType: "unknown",
          componentId: "failed",
          kind: "source",
          config: {},
          inputs: [],
          confidence: 0,
          notes: [],
          validationErrors: [],
          status: "failed",
        },
      ],
      vectorYaml: "",
      overallConfidence: 0,
      warnings: [],
    };

    await expect(
      generatePipeline({
        translationResult,
        environmentId: "env-123",
        pipelineName: "Test",
        migrationProjectId: "mig-123",
      }),
    ).rejects.toThrow("No successfully translated blocks");
  });

  it("positions nodes in columns by kind", async () => {
    const translationResult: TranslationResult = {
      blocks: [
        {
          blockId: "b1",
          componentType: "file",
          componentId: "src",
          kind: "source",
          config: {},
          inputs: [],
          confidence: 90,
          notes: [],
          validationErrors: [],
          status: "translated",
        },
        {
          blockId: "b2",
          componentType: "remap",
          componentId: "xform",
          kind: "transform",
          config: {},
          inputs: ["src"],
          confidence: 80,
          notes: [],
          validationErrors: [],
          status: "translated",
        },
        {
          blockId: "b3",
          componentType: "console",
          componentId: "sink",
          kind: "sink",
          config: {},
          inputs: ["xform"],
          confidence: 95,
          notes: [],
          validationErrors: [],
          status: "translated",
        },
      ],
      vectorYaml: "",
      overallConfidence: 88,
      warnings: [],
    };

    await generatePipeline({
      translationResult,
      environmentId: "env-123",
      pipelineName: "Layout Test",
      migrationProjectId: "mig-123",
    });

    const nodes = mockPrismaCreate.mock.calls[0][0].data.nodes.create;
    const srcNode = nodes.find((n: Record<string, unknown>) => n.componentKey === "src");
    const xformNode = nodes.find((n: Record<string, unknown>) => n.componentKey === "xform");
    const sinkNode = nodes.find((n: Record<string, unknown>) => n.componentKey === "sink");

    // Sources should be left of transforms, transforms left of sinks
    expect(srcNode.positionX).toBeLessThan(xformNode.positionX);
    expect(xformNode.positionX).toBeLessThan(sinkNode.positionX);
  });
});
