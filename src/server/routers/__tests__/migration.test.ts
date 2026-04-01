import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── vi.hoisted so `t` is available inside vi.mock factories ────────────────

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

vi.mock("@/server/services/migration/fluentd-parser", () => ({
  parseFluentdConfig: vi.fn(),
}));

vi.mock("@/server/services/migration/readiness", () => ({
  computeReadiness: vi.fn(),
}));

vi.mock("@/server/services/migration/ai-translator", () => ({
  translateBlocks: vi.fn(),
}));

vi.mock("@/server/services/migration/pipeline-generator", () => ({
  generatePipeline: vi.fn(),
}));

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { migrationRouter } from "@/server/routers/migration";
import * as fluentdParser from "@/server/services/migration/fluentd-parser";
import * as readiness from "@/server/services/migration/readiness";
import * as aiTranslator from "@/server/services/migration/ai-translator";
import * as pipelineGenerator from "@/server/services/migration/pipeline-generator";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(migrationRouter)({
  session: { user: { id: "user-1", email: "test@test.com" } },
  userRole: "EDITOR",
  teamId: "team-1",
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    name: "Fluentd Migration",
    teamId: "team-1",
    platform: "FLUENTD",
    status: "DRAFT",
    originalConfig: "<source>\n  @type forward\n</source>",
    parsedTopology: null,
    pluginInventory: null,
    translatedBlocks: null,
    validationResult: null,
    readinessScore: null,
    readinessReport: null,
    generatedPipelineId: null,
    errorMessage: null,
    createdById: "user-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("migration router", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ─── list ──────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("returns migration projects for a team", async () => {
      prismaMock.migrationProject.findMany.mockResolvedValue([
        {
          id: "proj-1",
          name: "My Migration",
          platform: "FLUENTD",
          status: "DRAFT",
          readinessScore: null,
          generatedPipelineId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: { id: "user-1", name: "Test", email: "test@test.com" },
        },
      ] as never);

      const result = await caller.list({ teamId: "team-1" });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("My Migration");
    });
  });

  // ─── get ───────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("returns a migration project by ID", async () => {
      prismaMock.migrationProject.findUnique.mockResolvedValue(
        makeProject() as never,
      );

      const result = await caller.get({ id: "proj-1", teamId: "team-1" });

      expect(result.id).toBe("proj-1");
    });

    it("throws NOT_FOUND when project does not exist", async () => {
      prismaMock.migrationProject.findUnique.mockResolvedValue(null);

      await expect(
        caller.get({ id: "nonexistent", teamId: "team-1" }),
      ).rejects.toThrow("Migration project not found");
    });

    it("throws FORBIDDEN when project belongs to a different team", async () => {
      prismaMock.migrationProject.findUnique.mockResolvedValue(
        makeProject({ teamId: "team-2" }) as never,
      );

      await expect(
        caller.get({ id: "proj-1", teamId: "team-1" }),
      ).rejects.toThrow("does not belong to this team");
    });
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("creates a new migration project", async () => {
      prismaMock.migrationProject.create.mockResolvedValue(
        makeProject() as never,
      );

      const result = await caller.create({
        teamId: "team-1",
        name: "Fluentd Migration",
        platform: "FLUENTD",
        originalConfig: "<source>\n  @type forward\n</source>",
      });

      expect(result.name).toBe("Fluentd Migration");
      expect(prismaMock.migrationProject.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "Fluentd Migration",
            platform: "FLUENTD",
            status: "DRAFT",
            createdById: "user-1",
          }),
        }),
      );
    });
  });

  // ─── delete ────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes a migration project", async () => {
      prismaMock.migrationProject.findUnique.mockResolvedValue(
        makeProject() as never,
      );
      prismaMock.migrationProject.delete.mockResolvedValue({} as never);

      const result = await caller.delete({ id: "proj-1", teamId: "team-1" });

      expect(result.success).toBe(true);
    });

    it("throws NOT_FOUND when project does not exist", async () => {
      prismaMock.migrationProject.findUnique.mockResolvedValue(null);

      await expect(
        caller.delete({ id: "nonexistent", teamId: "team-1" }),
      ).rejects.toThrow("Migration project not found");
    });

    it("throws FORBIDDEN when project belongs to a different team", async () => {
      prismaMock.migrationProject.findUnique.mockResolvedValue(
        makeProject({ teamId: "team-2" }) as never,
      );

      await expect(
        caller.delete({ id: "proj-1", teamId: "team-1" }),
      ).rejects.toThrow("does not belong to this team");
    });
  });

  // ─── parse ─────────────────────────────────────────────────────────────────

  describe("parse", () => {
    it("parses fluentd config and computes readiness", async () => {
      const parsedConfig = {
        blocks: [{ id: "b1", type: "source", plugin: "forward" }],
      };
      const readinessReport = {
        score: 85,
        pluginInventory: [{ plugin: "forward", supported: true }],
      };

      prismaMock.migrationProject.findUnique.mockResolvedValue(
        makeProject() as never,
      );
      prismaMock.migrationProject.update
        .mockResolvedValueOnce({} as never) // status = PARSING
        .mockResolvedValueOnce({
          ...makeProject(),
          parsedTopology: parsedConfig,
          readinessScore: 85,
          readinessReport,
          pluginInventory: readinessReport.pluginInventory,
        } as never);

      vi.mocked(fluentdParser.parseFluentdConfig).mockReturnValue(parsedConfig as never);
      vi.mocked(readiness.computeReadiness).mockReturnValue(readinessReport as never);

      const result = await caller.parse({ id: "proj-1", teamId: "team-1" });

      expect(result.readinessScore).toBe(85);
      expect(fluentdParser.parseFluentdConfig).toHaveBeenCalled();
    });

    it("sets status to FAILED when parsing throws", async () => {
      prismaMock.migrationProject.findUnique.mockResolvedValue(
        makeProject() as never,
      );
      prismaMock.migrationProject.update.mockResolvedValue({} as never);
      vi.mocked(fluentdParser.parseFluentdConfig).mockImplementation(() => {
        throw new Error("Invalid config");
      });

      await expect(
        caller.parse({ id: "proj-1", teamId: "team-1" }),
      ).rejects.toThrow("Invalid config");

      // Second call to update should set status to FAILED
      expect(prismaMock.migrationProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "FAILED",
          }),
        }),
      );
    });
  });

  // ─── translate ────────────────────────────────────────────────────────────

  describe("translate", () => {
    it("translates parsed blocks using AI", async () => {
      const translationResult = {
        blocks: [{ blockId: "b1", vectorType: "stdin", config: {} }],
        vectorYaml: "sources:\n  stdin: {}\n",
        overallConfidence: 90,
        warnings: [],
      };

      prismaMock.migrationProject.findUnique.mockResolvedValue(
        makeProject({
          parsedTopology: { blocks: [{ id: "b1" }] },
        }) as never,
      );
      prismaMock.team.findUnique.mockResolvedValue({
        aiEnabled: true,
        aiApiKey: "enc:key",
      } as never);
      prismaMock.migrationProject.update.mockResolvedValue({} as never);
      vi.mocked(aiTranslator.translateBlocks).mockResolvedValue(translationResult as never);

      const result = await caller.translate({ id: "proj-1", teamId: "team-1" });

      expect(result.overallConfidence).toBe(90);
    });

    it("throws BAD_REQUEST when config has not been parsed", async () => {
      prismaMock.migrationProject.findUnique.mockResolvedValue(
        makeProject({ parsedTopology: null }) as never,
      );

      await expect(
        caller.translate({ id: "proj-1", teamId: "team-1" }),
      ).rejects.toThrow("Config must be parsed before translation");
    });

    it("throws BAD_REQUEST when AI is not configured", async () => {
      prismaMock.migrationProject.findUnique.mockResolvedValue(
        makeProject({ parsedTopology: { blocks: [] } }) as never,
      );
      prismaMock.team.findUnique.mockResolvedValue({
        aiEnabled: false,
        aiApiKey: null,
      } as never);

      await expect(
        caller.translate({ id: "proj-1", teamId: "team-1" }),
      ).rejects.toThrow("AI is not configured");
    });
  });

  // ─── generate ─────────────────────────────────────────────────────────────

  describe("generate", () => {
    it("generates a pipeline from translated blocks", async () => {
      prismaMock.migrationProject.findUnique.mockResolvedValue(
        makeProject({
          translatedBlocks: { blocks: [], vectorYaml: "", overallConfidence: 90, warnings: [] },
        }) as never,
      );
      prismaMock.environment.findUnique.mockResolvedValue({
        teamId: "team-1",
      } as never);
      prismaMock.migrationProject.update.mockResolvedValue({} as never);
      vi.mocked(pipelineGenerator.generatePipeline).mockResolvedValue({
        id: "pipeline-new",
      } as never);

      const result = await caller.generate({
        id: "proj-1",
        teamId: "team-1",
        environmentId: "env-1",
        pipelineName: "Migrated Pipeline",
      });

      expect(result.pipelineId).toBe("pipeline-new");
    });

    it("throws BAD_REQUEST when blocks have not been translated", async () => {
      prismaMock.migrationProject.findUnique.mockResolvedValue(
        makeProject({ translatedBlocks: null }) as never,
      );

      await expect(
        caller.generate({
          id: "proj-1",
          teamId: "team-1",
          environmentId: "env-1",
          pipelineName: "Migrated",
        }),
      ).rejects.toThrow("Config must be translated before generating");
    });

    it("throws NOT_FOUND when environment belongs to a different team", async () => {
      prismaMock.migrationProject.findUnique.mockResolvedValue(
        makeProject({
          translatedBlocks: { blocks: [] },
        }) as never,
      );
      prismaMock.environment.findUnique.mockResolvedValue({
        teamId: "team-2",
      } as never);

      await expect(
        caller.generate({
          id: "proj-1",
          teamId: "team-1",
          environmentId: "env-other",
          pipelineName: "Migrated",
        }),
      ).rejects.toThrow("Environment not found or does not belong to this team");
    });
  });
});
