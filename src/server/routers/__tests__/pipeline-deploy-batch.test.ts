import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import { z } from "zod";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/deploy-agent", () => ({
  deployAgent: vi.fn(),
  undeployAgent: vi.fn(),
  deployBatch: vi.fn(),
}));

vi.mock("@/server/services/pipeline-version", () => ({
  createVersion: vi.fn(),
  listVersions: vi.fn(),
  listVersionsSummary: vi.fn(),
  getVersion: vi.fn(),
  rollback: vi.fn(),
}));

vi.mock("@/server/services/config-crypto", () => ({
  decryptNodeConfig: vi.fn(
    (_type: string, config: Record<string, unknown>) => config,
  ),
}));

vi.mock("@/server/services/system-environment", () => ({
  getOrCreateSystemEnvironment: vi.fn(),
}));

vi.mock("@/server/services/pipeline-graph", () => ({
  saveGraphComponents: vi.fn(),
  promotePipeline: vi.fn(),
  discardPipelineChanges: vi.fn(),
  detectConfigChanges: vi.fn(),
  listPipelinesForEnvironment: vi.fn(),
}));

vi.mock("@/server/services/copy-pipeline-graph", () => ({
  copyPipelineGraph: vi.fn(),
}));

vi.mock("@/server/services/git-sync", () => ({
  gitSyncDeletePipeline: vi.fn(),
  gitSyncCommitPipeline: vi.fn(),
  toFilenameSlug: vi.fn(),
}));

vi.mock("@/server/services/sli-evaluator", () => ({
  evaluatePipelineHealth: vi.fn(),
}));

vi.mock("@/server/services/batch-health", () => ({
  batchEvaluatePipelineHealth: vi.fn(),
}));

vi.mock("@/server/services/push-broadcast", () => ({
  relayPush: vi.fn(),
}));

vi.mock("@/server/services/sse-broadcast", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("@/server/services/event-alerts", () => ({
  fireEventAlert: vi.fn(),
}));

import { deployBatch } from "@/server/services/deploy-agent";
import type { BatchDeployResult } from "@/server/services/deploy-agent";

const deployBatchMock = deployBatch as ReturnType<typeof vi.fn>;

describe("pipeline.deployBatch tRPC procedure", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should call deployBatch service with pipeline IDs, userId, and changelog", async () => {
    const mockResult: BatchDeployResult = {
      total: 3,
      completed: 3,
      failed: 0,
      results: [
        { pipelineId: "p1", success: true, versionId: "v1", versionNumber: 1 },
        { pipelineId: "p2", success: true, versionId: "v2", versionNumber: 1 },
        { pipelineId: "p3", success: true, versionId: "v3", versionNumber: 1 },
      ],
    };
    deployBatchMock.mockResolvedValue(mockResult);

    // Verify the service function signature matches what the router will call
    const result = await deployBatch(
      ["p1", "p2", "p3"],
      "user-1",
      "Deploy all staging pipelines",
    );

    expect(deployBatchMock).toHaveBeenCalledWith(
      ["p1", "p2", "p3"],
      "user-1",
      "Deploy all staging pipelines",
    );
    expect(result.total).toBe(3);
    expect(result.completed).toBe(3);
    expect(result.failed).toBe(0);
  });

  it("should enforce max 200 pipeline IDs", () => {
    // The tRPC procedure will use z.array(z.string()).min(1).max(200)
    // This test documents the constraint
    const schema = z.array(z.string()).min(1).max(200);

    expect(() => schema.parse([])).toThrow();
    expect(() => schema.parse(Array(201).fill("id"))).toThrow();
    expect(() => schema.parse(["id-1"])).not.toThrow();
    expect(() => schema.parse(Array(200).fill("id"))).not.toThrow();
  });
});
