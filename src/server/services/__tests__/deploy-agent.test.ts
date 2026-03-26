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

vi.mock("@/server/services/validator", () => ({
  validateConfig: vi.fn(),
}));

vi.mock("@/server/services/pipeline-version", () => ({
  createVersion: vi.fn(),
}));

vi.mock("@/server/services/git-sync", () => ({
  gitSyncCommitPipeline: vi.fn(),
}));

vi.mock("@/server/services/push-broadcast", () => ({
  relayPush: vi.fn(),
}));

vi.mock("@/server/services/config-crypto", () => ({
  decryptNodeConfig: vi.fn((_type: string, config: Record<string, unknown>) => config),
}));

vi.mock("@/server/services/system-vector", () => ({
  startSystemVector: vi.fn(),
  stopSystemVector: vi.fn(),
}));

// ─── Import the mocked modules + SUT ───────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { generateVectorYaml } from "@/lib/config-generator";
import { validateConfig } from "@/server/services/validator";
import { createVersion } from "@/server/services/pipeline-version";
import { startSystemVector } from "@/server/services/system-vector";
import { relayPush } from "@/server/services/push-broadcast";
import { deployAgent, undeployAgent } from "@/server/services/deploy-agent";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const validateConfigMock = validateConfig as ReturnType<typeof vi.fn>;
const createVersionMock = createVersion as ReturnType<typeof vi.fn>;
const generateYamlMock = generateVectorYaml as ReturnType<typeof vi.fn>;
const startSystemVectorMock = startSystemVector as ReturnType<typeof vi.fn>;
const relayPushMock = vi.mocked(relayPush);

// ─── Fixture helpers ────────────────────────────────────────────────────────

function makePipelineWithGraph(overrides: Partial<{
  id: string;
  name: string;
  environmentId: string;
  isSystem: boolean;
  isDraft: boolean;
  enrichMetadata: boolean;
  globalConfig: Record<string, unknown> | null;
  nodeSelector: Record<string, string> | null;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
}> = {}) {
  return {
    id: overrides.id ?? "pipeline-1",
    name: overrides.name ?? "Test Pipeline",
    environmentId: overrides.environmentId ?? "env-1",
    isSystem: overrides.isSystem ?? false,
    isDraft: overrides.isDraft ?? false,
    enrichMetadata: overrides.enrichMetadata ?? false,
    globalConfig: overrides.globalConfig ?? null,
    nodeSelector: overrides.nodeSelector ?? null,
    environment: { name: "production" },
    nodes: overrides.nodes ?? [
      {
        id: "node-1",
        componentType: "http_server",
        componentKey: "my_source",
        kind: "source",
        config: { address: "0.0.0.0:8080" },
        positionX: 0,
        positionY: 0,
        disabled: false,
      },
    ],
    edges: overrides.edges ?? [],
  };
}

// ─── Tests: deployAgent ─────────────────────────────────────────────────────

describe("deployAgent", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  it("throws NOT_FOUND when pipeline does not exist", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue(null);

    await expect(deployAgent("missing-pipeline", "user-1")).rejects.toThrow(
      TRPCError,
    );
    await expect(
      deployAgent("missing-pipeline", "user-1"),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Pipeline not found",
    });
  });

  it("returns validation errors when config is invalid", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue(
      makePipelineWithGraph() as never,
    );
    generateYamlMock.mockReturnValue("invalid: yaml");

    validateConfigMock.mockResolvedValue({
      valid: false,
      errors: [{ message: "Unknown source type", componentKey: "my_source" }],
      warnings: [],
    });

    const result = await deployAgent("pipeline-1", "user-1");

    expect(result.success).toBe(false);
    expect(result.validationErrors).toHaveLength(1);
    expect(result.validationErrors![0]!.message).toBe("Unknown source type");
    // createVersion should NOT have been called
    expect(createVersionMock).not.toHaveBeenCalled();
  });

  it("deploys successfully with version creation", async () => {
    const pipeline = makePipelineWithGraph();
    prismaMock.pipeline.findUnique.mockResolvedValue(pipeline as never);
    generateYamlMock.mockReturnValue("sources:\n  my_source:\n    type: http_server\n");

    validateConfigMock.mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [],
    });

    createVersionMock.mockResolvedValue({
      id: "version-1",
      version: 1,
      configYaml: "sources:\n  my_source:\n    type: http_server\n",
    });

    // No git sync configured
    prismaMock.environment.findUnique.mockResolvedValue({
      id: "env-1",
      gitRepoUrl: null,
      gitToken: null,
    } as never);

    // No nodes to push to
    prismaMock.vectorNode.findMany.mockResolvedValue([]);

    const result = await deployAgent("pipeline-1", "user-1", "Deploy changelog");

    expect(result.success).toBe(true);
    expect(result.versionId).toBe("version-1");
    expect(result.versionNumber).toBe(1);
    expect(createVersionMock).toHaveBeenCalledOnce();
  });

  it("uses prebuiltConfigYaml when provided", async () => {
    const pipeline = makePipelineWithGraph();
    prismaMock.pipeline.findUnique.mockResolvedValue(pipeline as never);

    const prebuiltYaml = "# prebuilt\nsources:\n  my_source:\n    type: http_server\n";

    validateConfigMock.mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [],
    });

    createVersionMock.mockResolvedValue({
      id: "version-2",
      version: 2,
      configYaml: prebuiltYaml,
    });

    prismaMock.environment.findUnique.mockResolvedValue({
      id: "env-1",
      gitRepoUrl: null,
      gitToken: null,
    } as never);

    prismaMock.vectorNode.findMany.mockResolvedValue([]);

    const result = await deployAgent("pipeline-1", "user-1", undefined, prebuiltYaml);

    expect(result.success).toBe(true);
    // generateVectorYaml should NOT have been called since we provided prebuilt YAML
    expect(generateYamlMock).not.toHaveBeenCalled();
    // validateConfig should have been called with the prebuilt YAML
    expect(validateConfigMock).toHaveBeenCalledWith(prebuiltYaml);
  });

  it("starts system vector for system pipelines", async () => {
    const pipeline = makePipelineWithGraph({ isSystem: true });
    prismaMock.pipeline.findUnique.mockResolvedValue(pipeline as never);
    generateYamlMock.mockReturnValue("yaml");

    validateConfigMock.mockResolvedValue({ valid: true, errors: [], warnings: [] });
    createVersionMock.mockResolvedValue({
      id: "version-3",
      version: 3,
      configYaml: "yaml",
    });

    prismaMock.environment.findUnique.mockResolvedValue({
      id: "env-1",
      gitRepoUrl: null,
      gitToken: null,
    } as never);

    const result = await deployAgent("pipeline-1", "user-1");

    expect(result.success).toBe(true);
    expect(startSystemVectorMock).toHaveBeenCalledWith("yaml");
  });

  it("pushes config_changed to matching nodes for non-system pipelines", async () => {
    const pipeline = makePipelineWithGraph({
      isSystem: false,
      nodeSelector: { role: "worker" },
    });
    prismaMock.pipeline.findUnique.mockResolvedValue(pipeline as never);
    generateYamlMock.mockReturnValue("yaml");
    validateConfigMock.mockResolvedValue({ valid: true, errors: [], warnings: [] });
    createVersionMock.mockResolvedValue({
      id: "version-4",
      version: 4,
      configYaml: "yaml",
    });

    prismaMock.environment.findUnique.mockResolvedValue({
      id: "env-1",
      gitRepoUrl: null,
      gitToken: null,
    } as never);

    prismaMock.vectorNode.findMany.mockResolvedValue([
      { id: "vnode-1", labels: { role: "worker" } },
      { id: "vnode-2", labels: { role: "other" } },
    ] as never);

    const result = await deployAgent("pipeline-1", "user-1");

    expect(result.success).toBe(true);
    // Only matching node should receive push
    expect(relayPushMock).toHaveBeenCalledTimes(1);
    expect(relayPushMock).toHaveBeenCalledWith("vnode-1", {
      type: "config_changed",
      pipelineId: "pipeline-1",
      reason: "deploy",
    });
  });
});

// ─── Tests: undeployAgent ───────────────────────────────────────────────────

describe("undeployAgent", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  it("throws NOT_FOUND when pipeline does not exist", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue(null);

    await expect(undeployAgent("missing-pipeline")).rejects.toThrow(TRPCError);
    await expect(undeployAgent("missing-pipeline")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("marks pipeline as draft on undeploy", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({
      id: "pipeline-1",
      isSystem: false,
    } as never);
    prismaMock.pipeline.update.mockResolvedValue({} as never);

    const result = await undeployAgent("pipeline-1");

    expect(result.success).toBe(true);
    expect(prismaMock.pipeline.update).toHaveBeenCalledWith({
      where: { id: "pipeline-1" },
      data: { isDraft: true, deployedAt: null },
    });
  });
});
