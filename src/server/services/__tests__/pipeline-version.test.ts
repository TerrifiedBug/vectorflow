import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import { TRPCError } from "@trpc/server";

// ─── Module mocks ───────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/push-registry", () => ({
  pushRegistry: { send: vi.fn() },
}));

vi.mock("@/server/services/sse-registry", () => ({
  sseRegistry: { broadcast: vi.fn() },
}));

// ─── Import the mocked modules + SUT ───────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { pushRegistry } from "@/server/services/push-registry";
import {
  listVersionsSummary,
  deployFromVersion,
  rollback,
  createVersion,
} from "@/server/services/pipeline-version";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const pushRegistrySendMock = pushRegistry.send as ReturnType<typeof vi.fn>;

// ─── Fixture helpers ────────────────────────────────────────────────────────

function makeVersion(overrides: Partial<{
  id: string;
  pipelineId: string;
  version: number;
  configYaml: string;
  configToml: string | null;
  logLevel: string | null;
  globalConfig: Record<string, unknown> | null;
  nodesSnapshot: unknown;
  edgesSnapshot: unknown;
  changelog: string | null;
  createdById: string | null;
  createdAt: Date;
}> = {}) {
  return {
    id: overrides.id ?? "version-1",
    pipelineId: overrides.pipelineId ?? "pipeline-1",
    version: overrides.version ?? 1,
    configYaml: overrides.configYaml ?? "sources:\n  my_source:\n    type: http_server\n",
    configToml: overrides.configToml ?? null,
    logLevel: overrides.logLevel ?? null,
    globalConfig: overrides.globalConfig ?? null,
    nodesSnapshot: overrides.nodesSnapshot ?? null,
    edgesSnapshot: overrides.edgesSnapshot ?? null,
    changelog: overrides.changelog ?? null,
    createdById: overrides.createdById ?? "user-1",
    createdAt: overrides.createdAt ?? new Date("2026-01-15T00:00:00Z"),
  };
}

function makeVersionSummary(overrides: Partial<{
  id: string;
  pipelineId: string;
  version: number;
  changelog: string | null;
  createdById: string | null;
  createdAt: Date;
  createdBy: { name: string | null; email: string } | null;
}> = {}) {
  return {
    id: overrides.id ?? "version-1",
    pipelineId: overrides.pipelineId ?? "pipeline-1",
    version: overrides.version ?? 1,
    changelog: overrides.changelog ?? null,
    createdById: overrides.createdById ?? "user-1",
    createdAt: overrides.createdAt ?? new Date("2026-01-15T00:00:00Z"),
    createdBy: overrides.createdBy ?? { name: "Alice", email: "alice@example.com" },
  };
}

// ─── Tests: listVersionsSummary ─────────────────────────────────────────────

describe("listVersionsSummary", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  it("returns version metadata with author name but without blob fields", async () => {
    const summaries = [
      makeVersionSummary({ version: 2, id: "v2" }),
      makeVersionSummary({ version: 1, id: "v1" }),
    ];
    prismaMock.pipelineVersion.findMany.mockResolvedValue(summaries as never);

    const result = await listVersionsSummary("pipeline-1");

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty("id", "v2");
    expect(result[0]).toHaveProperty("version", 2);
    expect(result[0]).toHaveProperty("createdBy");
    expect(result[0]!.createdBy).toEqual({ name: "Alice", email: "alice@example.com" });
    // Verify the select query explicitly excludes blob fields
    expect(prismaMock.pipelineVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pipelineId: "pipeline-1" },
        orderBy: { version: "desc" },
        select: expect.objectContaining({
          id: true,
          pipelineId: true,
          version: true,
          changelog: true,
          createdById: true,
          createdAt: true,
          createdBy: { select: { name: true, email: true } },
        }),
      }),
    );
    // The select object should NOT contain blob fields
    const selectArg = (prismaMock.pipelineVersion.findMany as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0]!.select;
    expect(selectArg).not.toHaveProperty("configYaml");
    expect(selectArg).not.toHaveProperty("nodesSnapshot");
    expect(selectArg).not.toHaveProperty("edgesSnapshot");
  });

  it("returns versions ordered by version desc", async () => {
    const summaries = [
      makeVersionSummary({ version: 3, id: "v3" }),
      makeVersionSummary({ version: 2, id: "v2" }),
      makeVersionSummary({ version: 1, id: "v1" }),
    ];
    prismaMock.pipelineVersion.findMany.mockResolvedValue(summaries as never);

    const result = await listVersionsSummary("pipeline-1");

    expect(result).toHaveLength(3);
    expect(result.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(prismaMock.pipelineVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { version: "desc" } }),
    );
  });

  it("returns empty array for pipeline with no versions", async () => {
    prismaMock.pipelineVersion.findMany.mockResolvedValue([] as never);

    const result = await listVersionsSummary("pipeline-no-versions");

    expect(result).toEqual([]);
    expect(prismaMock.pipelineVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pipelineId: "pipeline-no-versions" } }),
    );
  });
});

// ─── Tests: deployFromVersion ───────────────────────────────────────────────

describe("deployFromVersion", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  it("throws NOT_FOUND when source version does not exist", async () => {
    prismaMock.pipelineVersion.findUnique.mockResolvedValue(null);

    await expect(
      deployFromVersion("pipeline-1", "nonexistent-version", "user-1"),
    ).rejects.toThrow(TRPCError);
    await expect(
      deployFromVersion("pipeline-1", "nonexistent-version", "user-1"),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Source version not found",
    });
  });

  it("throws BAD_REQUEST when source version belongs to different pipeline", async () => {
    prismaMock.pipelineVersion.findUnique.mockResolvedValue(
      makeVersion({ pipelineId: "other-pipeline" }) as never,
    );

    await expect(
      deployFromVersion("pipeline-1", "version-1", "user-1"),
    ).rejects.toThrow(TRPCError);
    await expect(
      deployFromVersion("pipeline-1", "version-1", "user-1"),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Source version does not belong to this pipeline",
    });
  });

  it("creates a new version with source version config/snapshots and sends push notifications", async () => {
    const sourceVersion = makeVersion({
      id: "source-v1",
      pipelineId: "pipeline-1",
      version: 1,
      configYaml: "sources:\n  my_source:\n    type: http_server\n",
      nodesSnapshot: [{ id: "node-1", componentKey: "my_source", componentType: "http_server", kind: "source", config: {}, positionX: 0, positionY: 0, disabled: false }],
      edgesSnapshot: [{ id: "edge-1", sourceNodeId: "node-1", targetNodeId: "node-2", sourcePort: null }],
    });

    prismaMock.pipelineVersion.findUnique.mockResolvedValue(sourceVersion as never);

    // Mock the $transaction to execute the callback
    prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
      if (typeof fn === "function") {
        return fn(prismaMock);
      }
    });

    // Mock createVersion internals: findFirst for latest version, then create
    prismaMock.pipelineVersion.findFirst.mockResolvedValue(
      makeVersion({ version: 2 }) as never,
    );
    const createdVersion = makeVersion({ id: "new-version", version: 3, pipelineId: "pipeline-1" });
    prismaMock.pipelineVersion.create.mockResolvedValue(createdVersion as never);
    prismaMock.pipeline.update.mockResolvedValue({} as never);

    // Mock pipeline lookup for push notifications
    prismaMock.pipeline.findUnique.mockResolvedValue({
      environmentId: "env-1",
      nodeSelector: { role: "worker" },
    } as never);

    // Mock nodes — one matches selector, one doesn't
    prismaMock.vectorNode.findMany.mockResolvedValue([
      { id: "vnode-1", labels: { role: "worker" } },
      { id: "vnode-2", labels: { role: "other" } },
    ] as never);

    pushRegistrySendMock.mockReturnValue(true);

    const result = await deployFromVersion("pipeline-1", "source-v1", "user-1");

    // Verify a new version was created
    expect(prismaMock.pipelineVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pipelineId: "pipeline-1",
          configYaml: sourceVersion.configYaml,
          version: 3,
        }),
      }),
    );

    // Verify push notification sent only to matching node
    expect(pushRegistrySendMock).toHaveBeenCalledTimes(1);
    expect(pushRegistrySendMock).toHaveBeenCalledWith("vnode-1", {
      type: "config_changed",
      pipelineId: "pipeline-1",
      reason: "deploy_from_version",
    });

    // Verify return shape
    expect(result.version).toBeDefined();
    expect(result.pushedNodeIds).toEqual(["vnode-1"]);
  });

  it("returns version info and pushed node IDs", async () => {
    const sourceVersion = makeVersion({ pipelineId: "pipeline-1" });
    prismaMock.pipelineVersion.findUnique.mockResolvedValue(sourceVersion as never);
    prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
      if (typeof fn === "function") return fn(prismaMock);
    });
    prismaMock.pipelineVersion.findFirst.mockResolvedValue(null as never);
    const createdVersion = makeVersion({ id: "created-v1", version: 1, pipelineId: "pipeline-1" });
    prismaMock.pipelineVersion.create.mockResolvedValue(createdVersion as never);
    prismaMock.pipeline.update.mockResolvedValue({} as never);
    prismaMock.pipeline.findUnique.mockResolvedValue({
      environmentId: "env-1",
      nodeSelector: null,
    } as never);
    prismaMock.vectorNode.findMany.mockResolvedValue([
      { id: "vnode-1", labels: {} },
    ] as never);
    pushRegistrySendMock.mockReturnValue(true);

    const result = await deployFromVersion("pipeline-1", "version-1", "user-1", "Custom changelog");

    expect(result).toHaveProperty("version");
    expect(result).toHaveProperty("pushedNodeIds");
    expect(result.version.id).toBe("created-v1");
    // With null nodeSelector, all nodes match (selectorEntries is empty → every() returns true)
    expect(result.pushedNodeIds).toEqual(["vnode-1"]);
  });

  it("handles null nodesSnapshot/edgesSnapshot gracefully (no graph restore)", async () => {
    const sourceVersion = makeVersion({
      pipelineId: "pipeline-1",
      nodesSnapshot: null,
      edgesSnapshot: null,
    });
    prismaMock.pipelineVersion.findUnique.mockResolvedValue(sourceVersion as never);
    prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
      if (typeof fn === "function") return fn(prismaMock);
    });
    prismaMock.pipelineVersion.findFirst.mockResolvedValue(null as never);
    prismaMock.pipelineVersion.create.mockResolvedValue(
      makeVersion({ id: "created-v1", version: 1 }) as never,
    );
    prismaMock.pipeline.update.mockResolvedValue({} as never);
    prismaMock.pipeline.findUnique.mockResolvedValue({
      environmentId: "env-1",
      nodeSelector: null,
    } as never);
    prismaMock.vectorNode.findMany.mockResolvedValue([] as never);

    const result = await deployFromVersion("pipeline-1", "version-1", "user-1");

    // Should not attempt to delete/recreate nodes
    expect(prismaMock.pipelineEdge.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.pipelineNode.deleteMany).not.toHaveBeenCalled();
    expect(result.version).toBeDefined();
    expect(result.pushedNodeIds).toEqual([]);
  });

  it("push notification failure is non-fatal — returns empty pushedNodeIds on push error", async () => {
    const sourceVersion = makeVersion({ pipelineId: "pipeline-1" });
    prismaMock.pipelineVersion.findUnique.mockResolvedValue(sourceVersion as never);
    prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
      if (typeof fn === "function") return fn(prismaMock);
    });
    prismaMock.pipelineVersion.findFirst.mockResolvedValue(null as never);
    prismaMock.pipelineVersion.create.mockResolvedValue(
      makeVersion({ id: "created-v1", version: 1 }) as never,
    );
    prismaMock.pipeline.update.mockResolvedValue({} as never);

    // Make pipeline.findUnique throw to trigger the catch block
    prismaMock.pipeline.findUnique.mockRejectedValue(new Error("DB connection lost"));

    const result = await deployFromVersion("pipeline-1", "version-1", "user-1");

    // Should still return successfully — push failure is non-fatal
    expect(result.version).toBeDefined();
    expect(result.pushedNodeIds).toEqual([]);
  });
});

// ─── Tests: rollback + push composition ─────────────────────────────────────

describe("rollback", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  it("rollback returns a new version — caller can compose push notifications", async () => {
    const targetVersion = makeVersion({
      id: "target-v1",
      pipelineId: "pipeline-1",
      version: 1,
      configYaml: "old config yaml",
    });

    prismaMock.pipelineVersion.findUnique.mockResolvedValue(targetVersion as never);
    prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
      if (typeof fn === "function") return fn(prismaMock);
    });
    prismaMock.pipelineVersion.findFirst.mockResolvedValue(
      makeVersion({ version: 3 }) as never,
    );
    const rollbackVersion = makeVersion({
      id: "rollback-v4",
      version: 4,
      pipelineId: "pipeline-1",
      configYaml: "old config yaml",
      changelog: "Rollback to version 1",
    });
    prismaMock.pipelineVersion.create.mockResolvedValue(rollbackVersion as never);
    prismaMock.pipeline.update.mockResolvedValue({} as never);

    const result = await rollback("pipeline-1", "target-v1", "user-1");

    // rollback() returns a version — the caller (router layer) is responsible for push/SSE
    expect(result).toBeDefined();
    expect(result.id).toBe("rollback-v4");
    expect(result.version).toBe(4);
    expect(result.configYaml).toBe("old config yaml");

    // Verify the new version was created with correct changelog
    expect(prismaMock.pipelineVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pipelineId: "pipeline-1",
          configYaml: "old config yaml",
          changelog: "Rollback to version 1",
        }),
      }),
    );

    // Verify the caller can now compose push: push is NOT called by rollback() itself
    // (push lives in the router layer, tested by the fact that pushRegistrySendMock is not called)
    expect(pushRegistrySendMock).not.toHaveBeenCalled();
  });

  it("rollback throws NOT_FOUND when target version does not exist", async () => {
    prismaMock.pipelineVersion.findUnique.mockResolvedValue(null);

    await expect(
      rollback("pipeline-1", "nonexistent", "user-1"),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Target version not found",
    });
  });
});
