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

vi.mock("@/server/services/deploy-agent", () => ({
  deployAgent: vi.fn(),
  undeployAgent: vi.fn(),
}));

vi.mock("@/server/services/pipeline-graph", () => ({
  saveGraphComponents: vi.fn(),
  promotePipeline: vi.fn(),
  discardPipelineChanges: vi.fn(),
  detectConfigChanges: vi.fn(),
  listPipelinesForEnvironment: vi.fn(),
}));

vi.mock("@/server/services/pipeline-version", () => ({
  createVersion: vi.fn(),
  listVersions: vi.fn(),
  listVersionsSummary: vi.fn(),
  getVersion: vi.fn(),
  rollback: vi.fn(),
}));

vi.mock("@/server/services/config-crypto", () => ({
  decryptNodeConfig: vi.fn((_, c: unknown) => c),
}));

vi.mock("@/server/services/system-environment", () => ({
  getOrCreateSystemEnvironment: vi.fn(),
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

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makePipeline(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    tags: ["existing-tag"],
    environment: { teamId: "team-1" },
    ...overrides,
  };
}

function makeTeam(overrides: Record<string, unknown> = {}) {
  return {
    id: "team-1",
    availableTags: ["tag-a", "tag-b", "existing-tag"],
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("bulk tag operations", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  // ── bulkAddTags ──────────────────────────────────────────────────────────

  describe("bulkAddTags", () => {
    it("adds tags to multiple pipelines successfully", async () => {
      prismaMock.pipeline.findUnique
        .mockResolvedValueOnce(makePipeline({ id: "p1", tags: [] }) as never) // first pipeline (team lookup)
        .mockResolvedValueOnce(makePipeline({ id: "p1", tags: [] }) as never) // loop iteration 1
        .mockResolvedValueOnce(makePipeline({ id: "p2", tags: ["old-tag"] }) as never); // loop iteration 2
      prismaMock.team.findUnique.mockResolvedValue(makeTeam({ availableTags: [] }) as never); // empty = no validation
      prismaMock.pipeline.update.mockResolvedValue({} as never);

      const result = await caller.bulkAddTags({
        pipelineIds: ["p1", "p2"],
        tags: ["tag-a"],
      });

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results.every((r) => r.success)).toBe(true);
    });

    it("validates tags against team.availableTags before the loop", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(makePipeline({ id: "p1" }) as never);
      prismaMock.team.findUnique.mockResolvedValue(makeTeam({ availableTags: ["tag-a", "tag-b"] }) as never);

      await expect(
        caller.bulkAddTags({
          pipelineIds: ["p1"],
          tags: ["invalid-tag"],
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("Invalid tags"),
      });
    });

    it("throws BAD_REQUEST for tags not in availableTags", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(makePipeline() as never);
      prismaMock.team.findUnique.mockResolvedValue(makeTeam({ availableTags: ["allowed"] }) as never);

      await expect(
        caller.bulkAddTags({
          pipelineIds: ["p1"],
          tags: ["not-allowed"],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("handles partial failure when some pipelines are not found", async () => {
      prismaMock.pipeline.findUnique
        .mockResolvedValueOnce(makePipeline({ id: "p1" }) as never) // first pipeline (team lookup)
        .mockResolvedValueOnce(makePipeline({ id: "p1", tags: [] }) as never) // loop: p1 found
        .mockResolvedValueOnce(null); // loop: p2 not found
      prismaMock.team.findUnique.mockResolvedValue(makeTeam({ availableTags: [] }) as never);
      prismaMock.pipeline.update.mockResolvedValue({} as never);

      const result = await caller.bulkAddTags({
        pipelineIds: ["p1", "p2"],
        tags: ["tag-a"],
      });

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(1);
      const failedResult = result.results.find((r) => r.pipelineId === "p2");
      expect(failedResult?.success).toBe(false);
      expect(failedResult?.error).toBe("Pipeline not found");
    });

    it("deduplicates tags — adding an existing tag does not create duplicates", async () => {
      prismaMock.pipeline.findUnique
        .mockResolvedValueOnce(makePipeline({ id: "p1" }) as never) // team lookup
        .mockResolvedValueOnce(makePipeline({ id: "p1", tags: ["existing-tag"] }) as never); // loop
      prismaMock.team.findUnique.mockResolvedValue(makeTeam({ availableTags: [] }) as never);
      prismaMock.pipeline.update.mockResolvedValue({} as never);

      await caller.bulkAddTags({
        pipelineIds: ["p1"],
        tags: ["existing-tag"],
      });

      // Update should be called with deduplicated tags (no duplicates)
      expect(prismaMock.pipeline.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { tags: ["existing-tag"] }, // only one instance
        }),
      );
    });

    it("enforces max 100 pipeline limit (rejects more than 100)", async () => {
      const tooMany = Array.from({ length: 101 }, (_, i) => `p${i}`);

      await expect(
        caller.bulkAddTags({
          pipelineIds: tooMany,
          tags: ["tag-a"],
        }),
      ).rejects.toThrow(); // Zod max(100) validation
    });

    it("throws NOT_FOUND when first pipeline for team lookup is not found", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValueOnce(null);

      await expect(
        caller.bulkAddTags({
          pipelineIds: ["nonexistent"],
          tags: ["tag-a"],
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ── bulkRemoveTags ───────────────────────────────────────────────────────

  describe("bulkRemoveTags", () => {
    it("removes specified tags from multiple pipelines", async () => {
      prismaMock.pipeline.findUnique
        .mockResolvedValueOnce(makePipeline({ id: "p1", tags: ["tag-a", "tag-b"] }) as never)
        .mockResolvedValueOnce(makePipeline({ id: "p2", tags: ["tag-a", "tag-c"] }) as never);
      prismaMock.pipeline.update.mockResolvedValue({} as never);

      const result = await caller.bulkRemoveTags({
        pipelineIds: ["p1", "p2"],
        tags: ["tag-a"],
      });

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(2);
      // p1 should have tag-b remaining, p2 should have tag-c remaining
      expect(prismaMock.pipeline.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ data: { tags: ["tag-b"] } }),
      );
      expect(prismaMock.pipeline.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ data: { tags: ["tag-c"] } }),
      );
    });

    it("handles pipelines that don't have the tag (no-op, still success)", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(
        makePipeline({ id: "p1", tags: ["unrelated-tag"] }) as never,
      );
      prismaMock.pipeline.update.mockResolvedValue({} as never);

      const result = await caller.bulkRemoveTags({
        pipelineIds: ["p1"],
        tags: ["nonexistent-tag"],
      });

      expect(result.succeeded).toBe(1);
      // Tags should remain unchanged
      expect(prismaMock.pipeline.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { tags: ["unrelated-tag"] },
        }),
      );
    });

    it("handles partial failure when pipeline is not found", async () => {
      prismaMock.pipeline.findUnique
        .mockResolvedValueOnce(makePipeline({ id: "p1", tags: ["tag-a"] }) as never) // p1 found
        .mockResolvedValueOnce(null); // p2 not found
      prismaMock.pipeline.update.mockResolvedValue({} as never);

      const result = await caller.bulkRemoveTags({
        pipelineIds: ["p1", "p2"],
        tags: ["tag-a"],
      });

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(1);
      const failedResult = result.results.find((r) => r.pipelineId === "p2");
      expect(failedResult?.success).toBe(false);
    });

    it("returns correct succeeded count", async () => {
      prismaMock.pipeline.findUnique
        .mockResolvedValueOnce(makePipeline({ id: "p1", tags: ["tag-a"] }) as never)
        .mockResolvedValueOnce(null) // p2 not found
        .mockResolvedValueOnce(makePipeline({ id: "p3", tags: ["tag-a"] }) as never);
      prismaMock.pipeline.update.mockResolvedValue({} as never);

      const result = await caller.bulkRemoveTags({
        pipelineIds: ["p1", "p2", "p3"],
        tags: ["tag-a"],
      });

      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(2);
    });
  });
});
