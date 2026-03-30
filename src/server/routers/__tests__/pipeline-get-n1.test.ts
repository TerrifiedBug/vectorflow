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

vi.mock("@/server/services/config-crypto", () => ({
  decryptNodeConfig: vi.fn(
    (_type: string, config: Record<string, unknown>) => config,
  ),
}));

vi.mock("@/lib/config-generator", () => ({
  generateVectorYaml: vi.fn(() => "sources: {}"),
}));

vi.mock("@/server/services/deploy-agent", () => ({
  deployAgent: vi.fn(),
  undeployAgent: vi.fn(),
}));

vi.mock("@/server/services/pipeline-version", () => ({
  createVersion: vi.fn(),
  listVersions: vi.fn(),
  listVersionsSummary: vi.fn(),
  getVersion: vi.fn(),
  rollback: vi.fn(),
}));

vi.mock("@/server/services/system-environment", () => ({
  getOrCreateSystemEnvironment: vi.fn(),
}));

vi.mock("@/server/services/pipeline-graph", () => ({
  saveGraphComponents: vi.fn(),
  promotePipeline: vi.fn(),
  discardPipelineChanges: vi.fn(),
  detectConfigChanges: vi.fn().mockReturnValue(false),
  listPipelinesForEnvironment: vi.fn(),
}));

vi.mock("@/server/services/copy-pipeline-graph", () => ({
  copyPipelineGraph: vi.fn(),
}));

vi.mock("@/server/services/git-sync", () => ({
  gitSyncDeletePipeline: vi.fn(),
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

// ─── Import SUT + mocks ────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { pipelineRouter } from "@/server/routers/pipeline";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(pipelineRouter)({
  session: { user: { id: "user-1" } },
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("pipeline.get N+1 fix", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("should NOT call pipelineVersion.findFirst separately", async () => {
    // After the fix, pipelineVersion.findFirst should never be called
    // because versions are included in the main query.

    const fakePipeline = {
      id: "pipe-1",
      name: "test",
      isDraft: false,
      deployedAt: new Date(),
      enrichMetadata: false,
      globalConfig: null,
      nodes: [],
      edges: [],
      environment: { teamId: "team-1", gitOpsMode: false, name: "prod" },
      nodeStatuses: [],
      versions: [
        { version: 3, configYaml: "sources: {}", logLevel: null },
      ],
    };

    prismaMock.pipeline.findUnique.mockResolvedValue(fakePipeline as never);

    const result = await caller.get({ id: "pipe-1" });

    // Verify the pipeline was fetched
    expect(prismaMock.pipeline.findUnique).toHaveBeenCalledTimes(1);

    // The key assertion: pipelineVersion.findFirst should not be called
    // after pipeline.findUnique already includes versions
    expect(prismaMock.pipelineVersion.findFirst).not.toHaveBeenCalled();

    // Verify the result still contains the correct data
    expect(result.id).toBe("pipe-1");
    expect(result.deployedVersionNumber).toBe(3);
  });
});
