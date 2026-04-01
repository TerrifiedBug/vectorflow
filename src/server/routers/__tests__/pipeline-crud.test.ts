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
}));

vi.mock("@/server/services/copy-pipeline-graph", () => ({
  copyPipelineGraph: vi.fn(),
}));

vi.mock("@/server/services/git-sync", () => ({
  gitSyncDeletePipeline: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { pipelineCrudRouter } from "@/server/routers/pipeline-crud";
import { getOrCreateSystemEnvironment } from "@/server/services/system-environment";
import { promotePipeline, detectConfigChanges, listPipelinesForEnvironment } from "@/server/services/pipeline-graph";
import { copyPipelineGraph } from "@/server/services/copy-pipeline-graph";
import { gitSyncDeletePipeline } from "@/server/services/git-sync";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(pipelineCrudRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

describe("pipelineCrudRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ── getSystemPipeline ────────────────────────────────────────────────────

  describe("getSystemPipeline", () => {
    it("returns the system pipeline when it exists", async () => {
      const pipeline = { id: "sys-1", name: "Audit Log Shipping", isDraft: true, deployedAt: null };
      prismaMock.pipeline.findFirst.mockResolvedValue(pipeline as never);

      const result = await caller.getSystemPipeline();

      expect(result).toEqual(pipeline);
      expect(prismaMock.pipeline.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isSystem: true },
        }),
      );
    });

    it("returns null when no system pipeline exists", async () => {
      prismaMock.pipeline.findFirst.mockResolvedValue(null as never);

      const result = await caller.getSystemPipeline();

      expect(result).toBeNull();
    });
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("delegates to listPipelinesForEnvironment with options", async () => {
      const pipelines = [{ id: "p-1", name: "Pipeline 1" }];
      vi.mocked(listPipelinesForEnvironment).mockResolvedValue(pipelines as never);

      const result = await caller.list({ environmentId: "env-1", search: "test" });

      expect(result).toEqual(pipelines);
      expect(listPipelinesForEnvironment).toHaveBeenCalledWith("env-1", expect.objectContaining({ search: "test" }));
    });
  });

  // ── get ───────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("returns pipeline with decrypted nodes", async () => {
      const pipeline = {
        id: "p-1",
        name: "Test Pipeline",
        isDraft: true,
        deployedAt: null,
        globalConfig: { log_level: "info" },
        enrichMetadata: false,
        nodes: [
          {
            id: "node-1",
            componentType: "stdin",
            config: { key: "value" },
            sharedComponent: null,
          },
        ],
        edges: [],
        environment: { teamId: "team-1", gitOpsMode: false, name: "Production" },
        nodeStatuses: [],
        versions: [],
      };
      prismaMock.pipeline.findUnique.mockResolvedValue(pipeline as never);

      const result = await caller.get({ id: "p-1" });

      expect(result.nodes[0].config).toEqual({ key: "value" });
      expect(result.hasConfigChanges).toBe(false);
      expect(result.gitOpsMode).toBe(false);
    });

    it("throws NOT_FOUND when pipeline does not exist", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(null as never);

      await expect(caller.get({ id: "nonexistent" })).rejects.toThrow("Pipeline not found");
    });

    it("detects config changes for deployed pipelines", async () => {
      const pipeline = {
        id: "p-1",
        name: "Test Pipeline",
        isDraft: false,
        deployedAt: new Date(),
        globalConfig: { log_level: "info" },
        enrichMetadata: false,
        nodes: [{ id: "node-1", componentType: "stdin", config: {}, sharedComponent: null }],
        edges: [],
        environment: { teamId: "team-1", gitOpsMode: false, name: "Production" },
        nodeStatuses: [],
        versions: [{ configYaml: "yaml", logLevel: "info", version: 1 }],
      };
      prismaMock.pipeline.findUnique.mockResolvedValue(pipeline as never);
      vi.mocked(detectConfigChanges).mockReturnValue(true);

      const result = await caller.get({ id: "p-1" });

      expect(result.hasConfigChanges).toBe(true);
      expect(result.deployedVersionNumber).toBe(1);
      expect(detectConfigChanges).toHaveBeenCalled();
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("throws NOT_FOUND when environment does not exist", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(null as never);

      await expect(
        caller.create({ name: "My Pipeline", environmentId: "env-missing" }),
      ).rejects.toThrow("Environment not found");
    });

    it("creates a pipeline when environment exists", async () => {
      const environment = { id: "env-1", name: "Production", teamId: "team-1" };
      const created = { id: "p-new", name: "My Pipeline", environmentId: "env-1" };
      prismaMock.environment.findUnique.mockResolvedValue(environment as never);
      prismaMock.pipeline.create.mockResolvedValue(created as never);

      const result = await caller.create({ name: "My Pipeline", environmentId: "env-1" });

      expect(result).toEqual(created);
      expect(prismaMock.pipeline.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "My Pipeline",
            environmentId: "env-1",
            globalConfig: { log_level: "info" },
          }),
        }),
      );
    });
  });

  // ── createSystemPipeline ──────────────────────────────────────────────────

  describe("createSystemPipeline", () => {
    it("creates a system pipeline with a source node", async () => {
      vi.mocked(getOrCreateSystemEnvironment).mockResolvedValue({ id: "sys-env-1" });

      const mockTx = {
        pipeline: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "sys-p-1", name: "Audit Log Shipping", isSystem: true }),
        },
        pipelineNode: {
          create: vi.fn().mockResolvedValue({ id: "node-1" }),
        },
      };
      prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockTx));

      const result = await caller.createSystemPipeline();

      expect(result).toEqual(
        expect.objectContaining({ id: "sys-p-1", name: "Audit Log Shipping", isSystem: true }),
      );
      expect(mockTx.pipeline.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: "Audit Log Shipping", isSystem: true }),
        }),
      );
      expect(mockTx.pipelineNode.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ componentType: "file", kind: "SOURCE" }),
        }),
      );
    });

    it("throws CONFLICT when a system pipeline already exists", async () => {
      vi.mocked(getOrCreateSystemEnvironment).mockResolvedValue({ id: "sys-env-1" });

      const mockTx = {
        pipeline: {
          findFirst: vi.fn().mockResolvedValue({ id: "existing" }),
        },
      };
      prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockTx));

      await expect(caller.createSystemPipeline()).rejects.toThrow("A system pipeline already exists");
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe("update", () => {
    it("updates pipeline fields", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue({
        id: "p-1",
        tags: [],
        environmentId: "env-1",
        environment: { teamId: "team-1" },
      } as never);
      const updated = { id: "p-1", name: "Renamed" };
      prismaMock.pipeline.update.mockResolvedValue(updated as never);

      const result = await caller.update({ id: "p-1", name: "Renamed" });

      expect(result).toEqual(updated);
      expect(prismaMock.pipeline.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "p-1" },
          data: expect.objectContaining({ name: "Renamed" }),
        }),
      );
    });

    it("throws NOT_FOUND when pipeline does not exist", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(null as never);

      await expect(caller.update({ id: "missing", name: "Nope" })).rejects.toThrow("Pipeline not found");
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes a pipeline", async () => {
      const existing = {
        id: "p-1",
        name: "To Delete",
        isSystem: false,
        deployedAt: null,
        environmentId: "env-1",
      };
      prismaMock.pipeline.findUnique.mockResolvedValueOnce(existing as never);
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1", gitRepoUrl: null, gitToken: null } as never);
      prismaMock.pipeline.delete.mockResolvedValue(existing as never);

      const result = await caller.delete({ id: "p-1" });

      expect(result).toEqual(existing);
      expect(prismaMock.pipeline.delete).toHaveBeenCalledWith({ where: { id: "p-1" } });
    });

    it("throws NOT_FOUND when pipeline does not exist", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(null as never);

      await expect(caller.delete({ id: "missing" })).rejects.toThrow("Pipeline not found");
    });

    it("throws FORBIDDEN when deleting a system pipeline", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue({
        id: "sys-1",
        isSystem: true,
        deployedAt: null,
        environmentId: "env-1",
      } as never);

      await expect(caller.delete({ id: "sys-1" })).rejects.toThrow("System pipelines cannot be deleted");
    });

    it("triggers git-sync delete when environment has git configured", async () => {
      const existing = {
        id: "p-1",
        name: "Git Pipeline",
        isSystem: false,
        deployedAt: null,
        environmentId: "env-1",
      };
      prismaMock.pipeline.findUnique
        .mockResolvedValueOnce(existing as never)
        .mockResolvedValueOnce({ id: "user-1", name: "Test User", email: "test@test.com" } as never);
      prismaMock.environment.findUnique.mockResolvedValue({
        id: "env-1",
        name: "Production",
        gitRepoUrl: "https://github.com/test/repo.git",
        gitToken: "enc:token",
        gitBranch: "main",
      } as never);
      prismaMock.pipeline.delete.mockResolvedValue(existing as never);
      prismaMock.user.findUnique.mockResolvedValue({ id: "user-1", name: "Test User", email: "test@test.com" } as never);
      vi.mocked(gitSyncDeletePipeline).mockResolvedValue(undefined as never);

      await caller.delete({ id: "p-1" });

      expect(gitSyncDeletePipeline).toHaveBeenCalledWith(
        expect.objectContaining({
          repoUrl: "https://github.com/test/repo.git",
          branch: "main",
          encryptedToken: "enc:token",
        }),
        "Production",
        "Git Pipeline",
        expect.objectContaining({ name: "Test User" }),
      );
    });
  });

  // ── clone ─────────────────────────────────────────────────────────────────

  describe("clone", () => {
    it("clones a pipeline with its graph", async () => {
      const source = {
        name: "Original",
        description: "A pipeline",
        environmentId: "env-1",
        globalConfig: { log_level: "info" },
      };
      prismaMock.pipeline.findUnique.mockResolvedValue(source as never);

      const cloned = { id: "p-clone", name: "Original (Copy)" };
      const mockTx = {
        pipeline: {
          create: vi.fn().mockResolvedValue(cloned),
        },
      };
      prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockTx));

      const result = await caller.clone({ pipelineId: "p-1" });

      expect(result).toEqual({ id: "p-clone", name: "Original (Copy)" });
      expect(mockTx.pipeline.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: "Original (Copy)" }),
        }),
      );
      expect(copyPipelineGraph).toHaveBeenCalledWith(mockTx, {
        sourcePipelineId: "p-1",
        targetPipelineId: "p-clone",
      });
    });

    it("throws NOT_FOUND when source pipeline does not exist", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(null as never);

      await expect(caller.clone({ pipelineId: "missing" })).rejects.toThrow("Pipeline not found");
    });
  });

  // ── promote ───────────────────────────────────────────────────────────────

  describe("promote", () => {
    it("delegates to promotePipeline service", async () => {
      const promoted = { id: "promoted-1", name: "Promoted Pipeline" };
      vi.mocked(promotePipeline).mockResolvedValue(promoted as never);

      const result = await caller.promote({
        pipelineId: "p-1",
        targetEnvironmentId: "env-prod",
        name: "Promoted Pipeline",
      });

      expect(result).toEqual(promoted);
      expect(promotePipeline).toHaveBeenCalledWith({
        sourcePipelineId: "p-1",
        targetEnvironmentId: "env-prod",
        name: "Promoted Pipeline",
        userId: "user-1",
      });
    });
  });
});
