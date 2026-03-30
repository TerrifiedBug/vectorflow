import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/lib/config-generator", () => ({
  generateVectorYaml: vi.fn(() => "sources: {}"),
}));

vi.mock("@/server/services/validator", () => ({
  validateConfig: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
}));

vi.mock("@/server/services/pipeline-version", () => ({
  createVersion: vi.fn().mockResolvedValue({
    id: "ver-1",
    version: 1,
    configYaml: "sources: {}",
  }),
}));

vi.mock("@/server/services/git-sync", () => ({
  gitSyncCommitPipeline: vi.fn(),
  toFilenameSlug: vi.fn((s: string) => s),
}));

vi.mock("@/server/services/push-broadcast", () => ({
  relayPush: vi.fn(),
}));

vi.mock("@/server/services/config-crypto", () => ({
  decryptNodeConfig: vi.fn(
    (_type: string, config: Record<string, unknown>) => config,
  ),
}));

vi.mock("@/server/services/system-vector", () => ({
  startSystemVector: vi.fn(),
  stopSystemVector: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { deployBatch } from "@/server/services/deploy-agent";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

function makePipeline(id: string) {
  return {
    id,
    name: `Pipeline ${id}`,
    environmentId: "env-1",
    isSystem: false,
    isDraft: true,
    enrichMetadata: false,
    globalConfig: null,
    nodeSelector: null,
    environment: { name: "production" },
    nodes: [
      {
        id: `node-${id}`,
        componentType: "http_server",
        componentKey: "src",
        kind: "source",
        config: {},
        positionX: 0,
        positionY: 0,
        disabled: false,
      },
    ],
    edges: [],
  };
}

describe("deployBatch", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("deploys multiple pipelines and returns results for each", async () => {
    const ids = ["pipe-1", "pipe-2", "pipe-3"];

    // Mock pipeline.findUnique to return a valid pipeline for each ID
    prismaMock.pipeline.findUnique.mockImplementation(((args: { where: { id: string } }) => {
      return Promise.resolve(makePipeline(args.where.id));
    }) as never);

    // Mock environment lookup (for git sync check)
    prismaMock.environment.findUnique.mockResolvedValue(null as never);

    // Mock vectorNode.findMany (for push notifications)
    prismaMock.vectorNode.findMany.mockResolvedValue([] as never);

    const result = await deployBatch(ids, "user-1", "batch deploy");

    expect(result.total).toBe(3);
    expect(result.completed).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(3);
    expect(result.results.every((r) => r.success)).toBe(true);
  });

  it("handles partial failures gracefully", async () => {
    const ids = ["pipe-ok", "pipe-fail"];

    prismaMock.pipeline.findUnique.mockImplementation(((args: { where: { id: string } }) => {
      if (args.where.id === "pipe-fail") return Promise.resolve(null);
      return Promise.resolve(makePipeline(args.where.id));
    }) as never);

    prismaMock.environment.findUnique.mockResolvedValue(null as never);
    prismaMock.vectorNode.findMany.mockResolvedValue([] as never);

    const result = await deployBatch(ids, "user-1", "batch deploy");

    expect(result.total).toBe(2);
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(1);

    const failedResult = result.results.find((r) => r.pipelineId === "pipe-fail");
    expect(failedResult?.success).toBe(false);
    expect(failedResult?.error).toBeDefined();
  });

  it("processes in batches of the configured concurrency", async () => {
    // Create 25 pipeline IDs to test batching with concurrency=10
    const ids = Array.from({ length: 25 }, (_, i) => `pipe-${i}`);
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    prismaMock.pipeline.findUnique.mockImplementation(((args: { where: { id: string } }) => {
      currentConcurrent++;
      if (currentConcurrent > maxConcurrent) {
        maxConcurrent = currentConcurrent;
      }
      return new Promise((resolve) => {
        setTimeout(() => {
          currentConcurrent--;
          resolve(makePipeline(args.where.id));
        }, 10);
      });
    }) as never);

    prismaMock.environment.findUnique.mockResolvedValue(null as never);
    prismaMock.vectorNode.findMany.mockResolvedValue([] as never);

    const result = await deployBatch(ids, "user-1", "batch deploy", 10);

    expect(result.total).toBe(25);
    expect(result.completed).toBe(25);
    // maxConcurrent should be <= 10 (the batch size)
    expect(maxConcurrent).toBeLessThanOrEqual(10);
  });

  it("returns empty results for empty input", async () => {
    const result = await deployBatch([], "user-1", "batch deploy");

    expect(result.total).toBe(0);
    expect(result.completed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results).toEqual([]);
  });
});
