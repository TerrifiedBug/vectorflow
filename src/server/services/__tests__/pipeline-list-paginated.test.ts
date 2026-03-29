import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

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

import { prisma } from "@/lib/prisma";
import { listPipelinesForEnvironment } from "@/server/services/pipeline-graph";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const NOW = new Date("2026-03-01T12:00:00Z");

function makePipelineRow(overrides: Partial<{
  id: string;
  name: string;
  isDraft: boolean;
  deployedAt: Date | null;
  tags: string[];
  groupId: string | null;
}> = {}) {
  return {
    id: overrides.id ?? "pipe-1",
    name: overrides.name ?? "test-pipeline",
    description: null,
    isDraft: overrides.isDraft ?? false,
    deployedAt: overrides.deployedAt ?? NOW,
    createdAt: NOW,
    updatedAt: NOW,
    tags: overrides.tags ?? [],
    enrichMetadata: false,
    groupId: overrides.groupId ?? null,
    group: overrides.groupId ? { id: overrides.groupId, name: "group-1", color: null } : null,
    environment: { name: "prod" },
    createdBy: null,
    updatedBy: null,
    nodeStatuses: [],
    nodes: [],
    edges: [],
    _count: { upstreamDeps: 0, downstreamDeps: 0 },
    versions: [{ version: 1, configYaml: "sources: {}", logLevel: "INFO" }],
    globalConfig: null,
  };
}

describe("listPipelinesForEnvironment — paginated", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("returns paginated results with nextCursor when more items exist", async () => {
    const rows = Array.from({ length: 51 }, (_, i) =>
      makePipelineRow({ id: `pipe-${i}`, name: `pipeline-${i}` })
    );
    prismaMock.pipeline.findMany.mockResolvedValueOnce(rows as never);
    prismaMock.pipeline.count.mockResolvedValueOnce(100);

    const result = await listPipelinesForEnvironment("env-1", {
      limit: 50,
    });

    expect(result.pipelines).toHaveLength(50);
    expect(result.nextCursor).toBe("pipe-49");
    expect(result.totalCount).toBe(100);
  });

  it("returns no nextCursor on last page", async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makePipelineRow({ id: `pipe-${i}`, name: `pipeline-${i}` })
    );
    prismaMock.pipeline.findMany.mockResolvedValueOnce(rows as never);
    prismaMock.pipeline.count.mockResolvedValueOnce(10);

    const result = await listPipelinesForEnvironment("env-1", {
      limit: 50,
    });

    expect(result.pipelines).toHaveLength(10);
    expect(result.nextCursor).toBeUndefined();
    expect(result.totalCount).toBe(10);
  });

  it("applies search filter (ILIKE on name)", async () => {
    prismaMock.pipeline.findMany.mockResolvedValueOnce([] as never);
    prismaMock.pipeline.count.mockResolvedValueOnce(0);

    await listPipelinesForEnvironment("env-1", {
      limit: 50,
      search: "nginx",
    });

    const findManyCall = prismaMock.pipeline.findMany.mock.calls[0][0];
    expect(findManyCall?.where?.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: { contains: "nginx", mode: "insensitive" },
        }),
      ])
    );
  });

  it("applies status filter", async () => {
    prismaMock.pipeline.findMany.mockResolvedValueOnce([] as never);
    prismaMock.pipeline.count.mockResolvedValueOnce(0);

    await listPipelinesForEnvironment("env-1", {
      limit: 50,
      status: ["deployed"],
    });

    const findManyCall = prismaMock.pipeline.findMany.mock.calls[0][0];
    expect(findManyCall?.where?.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          isDraft: false,
          deployedAt: { not: null },
        }),
      ])
    );
  });

  it("applies tag filter", async () => {
    prismaMock.pipeline.findMany.mockResolvedValueOnce([] as never);
    prismaMock.pipeline.count.mockResolvedValueOnce(0);

    await listPipelinesForEnvironment("env-1", {
      limit: 50,
      tags: ["PII"],
    });

    // Tags are stored as Json so we use Prisma json path filter
    const findManyCall = prismaMock.pipeline.findMany.mock.calls[0][0];
    expect(findManyCall?.where?.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tags: expect.anything(),
        }),
      ])
    );
  });

  it("applies groupId filter", async () => {
    prismaMock.pipeline.findMany.mockResolvedValueOnce([] as never);
    prismaMock.pipeline.count.mockResolvedValueOnce(0);

    await listPipelinesForEnvironment("env-1", {
      limit: 50,
      groupId: "grp-1",
    });

    const findManyCall = prismaMock.pipeline.findMany.mock.calls[0][0];
    expect(findManyCall?.where?.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId: "grp-1" }),
      ])
    );
  });

  it("applies cursor-based pagination", async () => {
    prismaMock.pipeline.findMany.mockResolvedValueOnce([] as never);
    prismaMock.pipeline.count.mockResolvedValueOnce(0);

    await listPipelinesForEnvironment("env-1", {
      limit: 50,
      cursor: "pipe-49",
    });

    const findManyCall = prismaMock.pipeline.findMany.mock.calls[0][0];
    expect(findManyCall?.cursor).toEqual({ id: "pipe-49" });
    expect(findManyCall?.skip).toBe(1);
  });

  it("applies sort by name ascending", async () => {
    prismaMock.pipeline.findMany.mockResolvedValueOnce([] as never);
    prismaMock.pipeline.count.mockResolvedValueOnce(0);

    await listPipelinesForEnvironment("env-1", {
      limit: 50,
      sortBy: "name",
      sortOrder: "asc",
    });

    const findManyCall = prismaMock.pipeline.findMany.mock.calls[0][0];
    expect(findManyCall?.orderBy).toEqual({ name: "asc" });
  });

  it("applies sort by updatedAt descending (default)", async () => {
    prismaMock.pipeline.findMany.mockResolvedValueOnce([] as never);
    prismaMock.pipeline.count.mockResolvedValueOnce(0);

    await listPipelinesForEnvironment("env-1", {
      limit: 50,
    });

    const findManyCall = prismaMock.pipeline.findMany.mock.calls[0][0];
    expect(findManyCall?.orderBy).toEqual({ updatedAt: "desc" });
  });

  it("clamps limit to max 200", async () => {
    prismaMock.pipeline.findMany.mockResolvedValueOnce([] as never);
    prismaMock.pipeline.count.mockResolvedValueOnce(0);

    await listPipelinesForEnvironment("env-1", {
      limit: 500,
    });

    const findManyCall = prismaMock.pipeline.findMany.mock.calls[0][0];
    expect(findManyCall?.take).toBe(201); // 200 + 1 for cursor detection
  });
});
