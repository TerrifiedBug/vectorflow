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
    denyInDemo: passthrough,
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

vi.mock("@/lib/logger", () => ({
  errorLog: vi.fn(),
  infoLog: vi.fn(),
  debugLog: vi.fn(),
  warnLog: vi.fn(),
}));

vi.mock("@/server/services/migration/fluentd-parser", () => ({
  parseFluentdConfig: vi.fn(),
}));

vi.mock("@/server/services/migration/readiness", () => ({
  computeReadiness: vi.fn(),
}));

vi.mock("@/server/services/migration/ai-translator", () => ({
  translateBlocks: vi.fn(),
  translateBlocksAsync: vi.fn(),
}));

vi.mock("@/server/services/migration/pipeline-generator", () => ({
  generatePipeline: vi.fn(),
}));

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { migrationRouter } from "@/server/routers/migration";
import * as aiTranslator from "@/server/services/migration/ai-translator";

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

describe("migration router — startTranslation", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  it("sets status to TRANSLATING and returns immediately", async () => {
    const parsedTopology = {
      blocks: [{ id: "b1", blockType: "source", pluginType: "forward" }],
      includes: [],
      globalParams: {},
      complexity: { totalBlocks: 1, rubyExpressionCount: 0, uniquePlugins: ["forward"], routingBranches: 0, nestedBlockDepth: 0, includeCount: 0 },
    };

    prismaMock.migrationProject.findUnique.mockResolvedValue(
      makeProject({ parsedTopology, status: "DRAFT" }) as never,
    );
    prismaMock.team.findUnique.mockResolvedValue({
      aiEnabled: true,
      aiApiKey: "enc:key",
    } as never);
    prismaMock.migrationProject.update.mockResolvedValue({} as never);

    // translateBlocksAsync is fire-and-forget — it should not block
    vi.mocked(aiTranslator.translateBlocksAsync).mockResolvedValue(undefined);

    const result = await caller.startTranslation({ id: "proj-1", teamId: "team-1" });

    expect(result).toEqual({ status: "TRANSLATING" });

    // Should set status to TRANSLATING
    expect(prismaMock.migrationProject.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "proj-1" },
        data: { status: "TRANSLATING" },
      }),
    );

    // Should kick off async translation (fire-and-forget)
    expect(aiTranslator.translateBlocksAsync).toHaveBeenCalledWith({
      projectId: "proj-1",
      teamId: "team-1",
      parsedConfig: parsedTopology,
      platform: "FLUENTD",
    });
  });

  it("throws NOT_FOUND when project does not exist", async () => {
    prismaMock.migrationProject.findUnique.mockResolvedValue(null);

    await expect(
      caller.startTranslation({ id: "nonexistent", teamId: "team-1" }),
    ).rejects.toThrow("Migration project not found");
  });

  it("throws FORBIDDEN when project belongs to a different team", async () => {
    prismaMock.migrationProject.findUnique.mockResolvedValue(
      makeProject({ teamId: "team-2" }) as never,
    );

    await expect(
      caller.startTranslation({ id: "proj-1", teamId: "team-1" }),
    ).rejects.toThrow("does not belong to this team");
  });

  it("throws BAD_REQUEST when config has not been parsed", async () => {
    prismaMock.migrationProject.findUnique.mockResolvedValue(
      makeProject({ parsedTopology: null }) as never,
    );

    await expect(
      caller.startTranslation({ id: "proj-1", teamId: "team-1" }),
    ).rejects.toThrow("Config must be parsed before translation");
  });

  it("throws BAD_REQUEST when project is already TRANSLATING", async () => {
    prismaMock.migrationProject.findUnique.mockResolvedValue(
      makeProject({
        parsedTopology: { blocks: [] },
        status: "TRANSLATING",
      }) as never,
    );

    await expect(
      caller.startTranslation({ id: "proj-1", teamId: "team-1" }),
    ).rejects.toThrow("already in progress");
  });

  it("throws BAD_REQUEST when AI is not configured", async () => {
    prismaMock.migrationProject.findUnique.mockResolvedValue(
      makeProject({
        parsedTopology: { blocks: [] },
        status: "DRAFT",
      }) as never,
    );
    prismaMock.team.findUnique.mockResolvedValue({
      aiEnabled: false,
      aiApiKey: null,
    } as never);

    await expect(
      caller.startTranslation({ id: "proj-1", teamId: "team-1" }),
    ).rejects.toThrow("AI is not configured");
  });
});
