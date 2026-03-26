import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import { TRPCError } from "@trpc/server";

// ─── Module mocks ───────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/lib/config-generator", () => ({
  generateVectorYaml: vi.fn(),
}));

vi.mock("@/server/services/config-crypto", () => ({
  encryptNodeConfig: vi.fn((_type: string, config: Record<string, unknown>) => config),
  decryptNodeConfig: vi.fn((_type: string, config: Record<string, unknown>) => config),
}));

vi.mock("@/server/services/copy-pipeline-graph", () => ({
  copyPipelineGraph: vi.fn(),
}));

vi.mock("@/server/services/strip-env-refs", () => ({
  stripEnvRefs: vi.fn((config: Record<string, unknown>) => ({
    config,
    strippedSecrets: [],
    strippedCertificates: [],
  })),
}));

// ─── Import the mocked modules + SUT ───────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { generateVectorYaml } from "@/lib/config-generator";
import {
  detectConfigChanges,
  saveGraphComponents,
  listPipelinesForEnvironment,
} from "@/server/services/pipeline-graph";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const generateYamlMock = generateVectorYaml as ReturnType<typeof vi.fn>;

// ─── Fixture helpers ────────────────────────────────────────────────────────

const NOW = new Date("2025-06-01T12:00:00Z");

function makeDecryptedNode(overrides: Partial<{
  id: string;
  componentType: string;
  componentKey: string;
  kind: string;
  config: Record<string, unknown>;
  positionX: number;
  positionY: number;
  disabled: boolean;
}> = {}) {
  return {
    id: overrides.id ?? "node-1",
    componentType: overrides.componentType ?? "http_server",
    componentKey: overrides.componentKey ?? "my_source",
    kind: overrides.kind ?? "source",
    config: overrides.config ?? { address: "0.0.0.0:8080" },
    positionX: overrides.positionX ?? 0,
    positionY: overrides.positionY ?? 0,
    disabled: overrides.disabled ?? false,
  };
}

function makeSimpleEdge(overrides: Partial<{
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePort: string | null;
}> = {}) {
  return {
    id: overrides.id ?? "edge-1",
    sourceNodeId: overrides.sourceNodeId ?? "node-1",
    targetNodeId: overrides.targetNodeId ?? "node-2",
    sourcePort: overrides.sourcePort ?? null,
  };
}

// ─── Tests: detectConfigChanges ─────────────────────────────────────────────

describe("detectConfigChanges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when no latest version exists", () => {
    const result = detectConfigChanges({
      nodes: [makeDecryptedNode()],
      edges: [makeSimpleEdge()],
      globalConfig: null,
      enrichMetadata: false,
      environmentName: "production",
      latestVersion: null,
    });
    expect(result).toBe(true);
  });

  it("returns true when latest version has no configYaml", () => {
    const result = detectConfigChanges({
      nodes: [makeDecryptedNode()],
      edges: [makeSimpleEdge()],
      globalConfig: null,
      enrichMetadata: false,
      environmentName: "production",
      latestVersion: { version: 1, configYaml: null },
    });
    expect(result).toBe(true);
  });

  it("returns false when YAML matches deployed version", () => {
    const deployedYaml = "sources:\n  my_source:\n    type: http_server\n";
    generateYamlMock.mockReturnValue(deployedYaml);

    const result = detectConfigChanges({
      nodes: [makeDecryptedNode()],
      edges: [makeSimpleEdge()],
      globalConfig: null,
      enrichMetadata: false,
      environmentName: "production",
      latestVersion: { version: 1, configYaml: deployedYaml },
    });
    expect(result).toBe(false);
  });

  it("returns true when YAML differs from deployed version", () => {
    generateYamlMock.mockReturnValue("sources:\n  my_source:\n    type: http_server\n    address: 0.0.0.0:9090\n");

    const result = detectConfigChanges({
      nodes: [makeDecryptedNode()],
      edges: [makeSimpleEdge()],
      globalConfig: null,
      enrichMetadata: false,
      environmentName: "production",
      latestVersion: { version: 1, configYaml: "sources:\n  my_source:\n    type: http_server\n" },
    });
    expect(result).toBe(true);
  });

  it("detects log level change even when YAML matches", () => {
    const yaml = "sources:\n  my_source:\n    type: http_server\n";
    generateYamlMock.mockReturnValue(yaml);

    const result = detectConfigChanges({
      nodes: [makeDecryptedNode()],
      edges: [makeSimpleEdge()],
      globalConfig: { log_level: "debug" },
      enrichMetadata: false,
      environmentName: "production",
      latestVersion: { version: 1, configYaml: yaml, logLevel: "info" },
    });
    expect(result).toBe(true);
  });

  it("returns false when generateVectorYaml throws", () => {
    generateYamlMock.mockImplementation(() => {
      throw new Error("Generation failed");
    });

    const result = detectConfigChanges({
      nodes: [makeDecryptedNode()],
      edges: [makeSimpleEdge()],
      globalConfig: null,
      enrichMetadata: false,
      environmentName: "production",
      latestVersion: { version: 1, configYaml: "some yaml" },
    });
    // The catch block returns false
    expect(result).toBe(false);
  });
});

// ─── Tests: saveGraphComponents ─────────────────────────────────────────────

describe("saveGraphComponents", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("throws NOT_FOUND when pipeline does not exist", async () => {
    // Use prismaMock as the Tx parameter — it satisfies DeepMockProxy<PrismaClient>
    // which also satisfies Prisma.TransactionClient
    prismaMock.pipeline.findUnique.mockResolvedValue(null);

    await expect(
      saveGraphComponents(prismaMock as unknown as Parameters<typeof saveGraphComponents>[0], {
        pipelineId: "missing-pipeline",
        nodes: [],
        edges: [],
        globalConfig: null,
        userId: "user-1",
      }),
    ).rejects.toThrow(TRPCError);

    await expect(
      saveGraphComponents(prismaMock as unknown as Parameters<typeof saveGraphComponents>[0], {
        pipelineId: "missing-pipeline",
        nodes: [],
        edges: [],
        globalConfig: null,
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Pipeline not found",
    });
  });

  it("throws BAD_REQUEST when shared component not found", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({
      id: "pipeline-1",
      environmentId: "env-1",
    } as never);

    // No shared components found in DB
    prismaMock.sharedComponent.findMany.mockResolvedValue([]);

    await expect(
      saveGraphComponents(prismaMock as unknown as Parameters<typeof saveGraphComponents>[0], {
        pipelineId: "pipeline-1",
        nodes: [
          {
            componentKey: "my_source",
            componentType: "http_server",
            kind: "SOURCE" as never,
            config: {},
            positionX: 0,
            positionY: 0,
            disabled: false,
            sharedComponentId: "nonexistent-sc",
          },
        ],
        edges: [],
        globalConfig: null,
        userId: "user-1",
      }),
    ).rejects.toThrow(TRPCError);

    // Reset mock for the second assertion call
    prismaMock.pipeline.findUnique.mockResolvedValue({
      id: "pipeline-1",
      environmentId: "env-1",
    } as never);
    prismaMock.sharedComponent.findMany.mockResolvedValue([]);

    await expect(
      saveGraphComponents(prismaMock as unknown as Parameters<typeof saveGraphComponents>[0], {
        pipelineId: "pipeline-1",
        nodes: [
          {
            componentKey: "my_source",
            componentType: "http_server",
            kind: "SOURCE" as never,
            config: {},
            positionX: 0,
            positionY: 0,
            disabled: false,
            sharedComponentId: "nonexistent-sc",
          },
        ],
        edges: [],
        globalConfig: null,
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("not found"),
    });
  });

  it("saves graph and returns pipeline with decrypted configs on success", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({
      id: "pipeline-1",
      environmentId: "env-1",
    } as never);

    prismaMock.pipeline.update.mockResolvedValue({} as never);
    prismaMock.pipelineEdge.deleteMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.pipelineNode.deleteMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.pipelineNode.create.mockResolvedValue({} as never);

    const savedPipeline = {
      id: "pipeline-1",
      nodes: [
        {
          id: "node-1",
          componentType: "http_server",
          componentKey: "my_source",
          config: { address: "0.0.0.0:8080" },
        },
      ],
      edges: [],
    };
    prismaMock.pipeline.findUniqueOrThrow.mockResolvedValue(savedPipeline as never);

    const result = await saveGraphComponents(
      prismaMock as unknown as Parameters<typeof saveGraphComponents>[0],
      {
        pipelineId: "pipeline-1",
        nodes: [
          {
            componentKey: "my_source",
            componentType: "http_server",
            kind: "SOURCE" as never,
            config: { address: "0.0.0.0:8080" },
            positionX: 0,
            positionY: 0,
            disabled: false,
          },
        ],
        edges: [],
        globalConfig: null,
        userId: "user-1",
      },
    );

    expect(result.id).toBe("pipeline-1");
    expect(result.nodes).toHaveLength(1);
    // decryptNodeConfig is mocked to pass-through
    expect(result.nodes[0]!.config).toEqual({ address: "0.0.0.0:8080" });
    expect(prismaMock.pipelineEdge.deleteMany).toHaveBeenCalledOnce();
    expect(prismaMock.pipelineNode.deleteMany).toHaveBeenCalledOnce();
  });
});

// ─── Tests: listPipelinesForEnvironment ─────────────────────────────────────

describe("listPipelinesForEnvironment", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  it("returns empty array for environment with no pipelines", async () => {
    prismaMock.pipeline.findMany.mockResolvedValue([]);

    const result = await listPipelinesForEnvironment("empty-env");
    expect(result).toEqual([]);
  });

  it("returns mapped pipelines with computed fields", async () => {
    const deployedYaml = "sources:\n  my_source:\n    type: http_server\n";
    generateYamlMock.mockReturnValue(deployedYaml);

    prismaMock.pipeline.findMany.mockResolvedValue([
      {
        id: "pipeline-1",
        name: "Test Pipeline",
        description: "A test pipeline",
        isDraft: false,
        deployedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
        globalConfig: null,
        tags: ["tag1"],
        enrichMetadata: false,
        environment: { name: "production" },
        createdBy: { name: "User", email: "user@example.com", image: null },
        updatedBy: { name: "User", email: "user@example.com", image: null },
        nodeStatuses: [],
        nodes: [
          {
            id: "node-1",
            componentType: "http_server",
            componentKey: "my_source",
            kind: "SOURCE",
            config: { address: "0.0.0.0:8080" },
            positionX: 0,
            positionY: 0,
            disabled: false,
            sharedComponentId: null,
            sharedComponentVersion: null,
            sharedComponent: null,
          },
        ],
        edges: [],
        versions: [{ version: 1, configYaml: deployedYaml, logLevel: null }],
        groupId: null,
        group: null,
        _count: { upstreamDeps: 0, downstreamDeps: 0 },
      },
    ] as never);

    const result = await listPipelinesForEnvironment("env-1");

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("pipeline-1");
    expect(result[0]!.name).toBe("Test Pipeline");
    expect(result[0]!.hasUndeployedChanges).toBe(false);
    expect(result[0]!.hasStaleComponents).toBe(false);
    expect(result[0]!.staleComponentNames).toEqual([]);
    expect(result[0]!.tags).toEqual(["tag1"]);
  });

  it("detects stale shared components", async () => {
    generateYamlMock.mockReturnValue("yaml");

    prismaMock.pipeline.findMany.mockResolvedValue([
      {
        id: "pipeline-2",
        name: "Stale Pipeline",
        description: null,
        isDraft: false,
        deployedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
        globalConfig: null,
        tags: [],
        enrichMetadata: false,
        environment: { name: "production" },
        createdBy: null,
        updatedBy: null,
        nodeStatuses: [],
        nodes: [
          {
            id: "node-1",
            componentType: "http_server",
            componentKey: "my_source",
            kind: "SOURCE",
            config: {},
            positionX: 0,
            positionY: 0,
            disabled: false,
            sharedComponentId: "sc-1",
            sharedComponentVersion: 1,
            sharedComponent: { version: 3, name: "Shared HTTP Source" },
          },
        ],
        edges: [],
        versions: [{ version: 1, configYaml: "yaml", logLevel: null }],
        groupId: null,
        group: null,
        _count: { upstreamDeps: 0, downstreamDeps: 0 },
      },
    ] as never);

    const result = await listPipelinesForEnvironment("env-1");

    expect(result).toHaveLength(1);
    expect(result[0]!.hasStaleComponents).toBe(true);
    expect(result[0]!.staleComponentNames).toEqual(["Shared HTTP Source"]);
  });

  it("marks draft pipelines as not having undeployed changes", async () => {
    prismaMock.pipeline.findMany.mockResolvedValue([
      {
        id: "pipeline-3",
        name: "Draft Pipeline",
        description: null,
        isDraft: true,
        deployedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        globalConfig: null,
        tags: [],
        enrichMetadata: false,
        environment: { name: "staging" },
        createdBy: null,
        updatedBy: null,
        nodeStatuses: [],
        nodes: [],
        edges: [],
        versions: [],
        groupId: null,
        group: null,
        _count: { upstreamDeps: 0, downstreamDeps: 0 },
      },
    ] as never);

    const result = await listPipelinesForEnvironment("env-2");

    expect(result).toHaveLength(1);
    expect(result[0]!.hasUndeployedChanges).toBe(false);
  });
});
