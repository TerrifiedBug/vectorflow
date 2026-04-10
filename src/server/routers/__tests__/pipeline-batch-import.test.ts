import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { t } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return { t };
});

vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx }));
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    withTeamAccess: passthrough,
    requireSuperAdmin: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/server/middleware/audit", () => ({
  withAudit: () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/config-crypto", () => ({
  decryptNodeConfig: vi.fn((_type: unknown, config: unknown) => config),
}));

vi.mock("@/server/services/system-environment", () => ({
  getOrCreateSystemEnvironment: vi.fn(),
}));

vi.mock("@/server/services/pipeline-graph", () => ({
  promotePipeline: vi.fn(),
  detectConfigChanges: vi.fn(),
  listPipelinesForEnvironment: vi.fn(),
  saveGraphComponents: vi.fn(),
}));

vi.mock("@/server/services/copy-pipeline-graph", () => ({
  copyPipelineGraph: vi.fn(),
}));

vi.mock("@/server/services/git-sync", () => ({
  gitSyncDeletePipeline: vi.fn(),
}));

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...actual,
    generateId: vi.fn(() => "generated-id"),
  };
});

import { prisma } from "@/lib/prisma";
import { pipelineCrudRouter } from "@/server/routers/pipeline-crud";
import { saveGraphComponents } from "@/server/services/pipeline-graph";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(pipelineCrudRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

const makePipeline = (overrides?: Record<string, unknown>) => ({
  name: "Imported Pipeline",
  description: "From Vector config",
  nodes: [
    {
      componentKey: "my_source",
      componentType: "stdin",
      kind: "SOURCE" as const,
      config: {},
      positionX: 100,
      positionY: 200,
    },
    {
      componentKey: "my_sink",
      componentType: "console",
      kind: "SINK" as const,
      config: {},
      positionX: 300,
      positionY: 200,
    },
  ],
  edges: [
    { sourceNodeId: "my_source", targetNodeId: "my_sink" },
  ],
  globalConfig: { log_level: "info" },
  ...overrides,
});

describe("pipelineCrudRouter.batchImport", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  it("rejects an empty pipelines array", async () => {
    await expect(
      caller.batchImport({ environmentId: "env-1", pipelines: [] }),
    ).rejects.toThrow();
  });

  it("creates all pipelines inside a single transaction and calls saveGraphComponents for each", async () => {
    const createdPipeline = { id: "p-new-1", name: "Imported Pipeline" };

    const mockTx = {
      pipeline: {
        create: vi.fn().mockResolvedValue(createdPipeline),
      },
    };
    prismaMock.$transaction.mockImplementation(async (fn) => (fn as (tx: unknown) => unknown)(mockTx));
    vi.mocked(saveGraphComponents).mockResolvedValue({} as never);

    const result = await caller.batchImport({
      environmentId: "env-1",
      pipelines: [makePipeline()],
    });

    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
    expect(mockTx.pipeline.create).toHaveBeenCalledOnce();
    expect(mockTx.pipeline.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Imported Pipeline",
          environmentId: "env-1",
          globalConfig: { log_level: "info" },
          createdById: "user-1",
          updatedById: "user-1",
        }),
      }),
    );
    expect(saveGraphComponents).toHaveBeenCalledOnce();
    expect(saveGraphComponents).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        pipelineId: "p-new-1",
        userId: "user-1",
      }),
    );
    expect(result).toEqual({ created: [{ id: "p-new-1", name: "Imported Pipeline" }] });
  });

  it("creates multiple pipelines and returns all created entries", async () => {
    const mockTx = {
      pipeline: {
        create: vi.fn()
          .mockResolvedValueOnce({ id: "p-1", name: "Pipeline A" })
          .mockResolvedValueOnce({ id: "p-2", name: "Pipeline B" }),
      },
    };
    prismaMock.$transaction.mockImplementation(async (fn) => (fn as (tx: unknown) => unknown)(mockTx));
    vi.mocked(saveGraphComponents).mockResolvedValue({} as never);

    const result = await caller.batchImport({
      environmentId: "env-1",
      pipelines: [
        makePipeline({ name: "Pipeline A" }),
        makePipeline({ name: "Pipeline B" }),
      ],
    });

    expect(mockTx.pipeline.create).toHaveBeenCalledTimes(2);
    expect(saveGraphComponents).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      created: [
        { id: "p-1", name: "Pipeline A" },
        { id: "p-2", name: "Pipeline B" },
      ],
    });
  });

  it("maps edge componentKey references to generated node IDs", async () => {
    const { generateId } = await import("@/lib/utils");
    vi.mocked(generateId)
      .mockReturnValueOnce("node-id-source")
      .mockReturnValueOnce("node-id-sink");

    const mockTx = {
      pipeline: {
        create: vi.fn().mockResolvedValue({ id: "p-1", name: "Mapped Pipeline" }),
      },
    };
    prismaMock.$transaction.mockImplementation(async (fn) => (fn as (tx: unknown) => unknown)(mockTx));
    vi.mocked(saveGraphComponents).mockResolvedValue({} as never);

    await caller.batchImport({
      environmentId: "env-1",
      pipelines: [makePipeline({ name: "Mapped Pipeline" })],
    });

    expect(saveGraphComponents).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: "node-id-source", componentKey: "my_source" }),
          expect.objectContaining({ id: "node-id-sink", componentKey: "my_sink" }),
        ]),
        edges: expect.arrayContaining([
          expect.objectContaining({ sourceNodeId: "node-id-source", targetNodeId: "node-id-sink" }),
        ]),
      }),
    );
  });

  it("handles pipelines with no edges", async () => {
    const mockTx = {
      pipeline: {
        create: vi.fn().mockResolvedValue({ id: "p-1", name: "Solo Pipeline" }),
      },
    };
    prismaMock.$transaction.mockImplementation(async (fn) => (fn as (tx: unknown) => unknown)(mockTx));
    vi.mocked(saveGraphComponents).mockResolvedValue({} as never);

    await expect(
      caller.batchImport({
        environmentId: "env-1",
        pipelines: [makePipeline({ name: "Solo Pipeline", edges: [] })],
      }),
    ).resolves.toEqual({ created: [{ id: "p-1", name: "Solo Pipeline" }] });

    expect(saveGraphComponents).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ edges: [] }),
    );
  });

  it("handles null globalConfig", async () => {
    const mockTx = {
      pipeline: {
        create: vi.fn().mockResolvedValue({ id: "p-1", name: "No Config Pipeline" }),
      },
    };
    prismaMock.$transaction.mockImplementation(async (fn) => (fn as (tx: unknown) => unknown)(mockTx));
    vi.mocked(saveGraphComponents).mockResolvedValue({} as never);

    await expect(
      caller.batchImport({
        environmentId: "env-1",
        pipelines: [makePipeline({ name: "No Config Pipeline", globalConfig: null })],
      }),
    ).resolves.toBeDefined();

    expect(mockTx.pipeline.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ globalConfig: null }),
      }),
    );
  });
});
