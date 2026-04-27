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

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { gitSyncRouter } from "@/server/routers/git-sync";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(gitSyncRouter)({
  session: { user: { id: "user-1", email: "test@test.com" } },
  userRole: "EDITOR",
  teamId: "team-1",
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("git-sync router", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ─── status ────────────────────────────────────────────────────────────────

  describe("status", () => {
    it("returns sync status summary for an environment", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({
        id: "env-1",
        gitRepoUrl: "https://github.com/org/repo",
        gitBranch: "main",
        gitOpsMode: "push",
        gitProvider: "github",
      } as never);
      prismaMock.gitSyncJob.count
        .mockResolvedValueOnce(2) // pending
        .mockResolvedValueOnce(1); // failed
      prismaMock.gitSyncJob.findFirst
        .mockResolvedValueOnce({ completedAt: new Date("2026-03-31") } as never) // lastCompleted
        .mockResolvedValueOnce({ lastError: "auth failed", completedAt: new Date("2026-03-30") } as never); // lastFailed

      const result = await caller.status({ environmentId: "env-1" });

      expect(result.gitRepoUrl).toBe("https://github.com/org/repo");
      expect(result.gitOpsMode).toBe("push");
      expect(result.pendingCount).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.lastError).toBe("auth failed");
    });

    it("throws NOT_FOUND when environment does not exist", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(null);

      await expect(
        caller.status({ environmentId: "nonexistent" }),
      ).rejects.toThrow("Environment not found");
    });

    it("returns null dates when no completed or failed jobs exist", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({
        id: "env-1",
        gitRepoUrl: null,
        gitBranch: null,
        gitOpsMode: "off",
        gitProvider: null,
      } as never);
      prismaMock.gitSyncJob.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      prismaMock.gitSyncJob.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await caller.status({ environmentId: "env-1" });

      expect(result.lastSuccessfulSync).toBeNull();
      expect(result.lastError).toBeNull();
      expect(result.lastErrorAt).toBeNull();
    });
  });

  // ─── jobs ──────────────────────────────────────────────────────────────────

  describe("jobs", () => {
    it("returns recent sync jobs for an environment", async () => {
      prismaMock.gitSyncJob.findMany.mockResolvedValue([
        {
          id: "job-1",
          environmentId: "env-1",
          status: "completed",
          pipeline: { id: "p-1", name: "Pipeline 1" },
        },
      ] as never);

      const result = await caller.jobs({ environmentId: "env-1" });

      expect(result).toHaveLength(1);
      expect(prismaMock.gitSyncJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { environmentId: "env-1" },
          take: 25,
        }),
      );
    });

    it("filters by status when provided", async () => {
      prismaMock.gitSyncJob.findMany.mockResolvedValue([] as never);

      await caller.jobs({ environmentId: "env-1", status: "failed" });

      expect(prismaMock.gitSyncJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { environmentId: "env-1", status: "failed" },
        }),
      );
    });
  });

  // ─── retryAllFailed ───────────────────────────────────────────────────────

  describe("retryAllFailed", () => {
    it("resets all failed jobs to pending", async () => {
      prismaMock.gitSyncJob.updateMany.mockResolvedValue({ count: 3 } as never);

      const result = await caller.retryAllFailed({ environmentId: "env-1" });

      expect(result.retriedCount).toBe(3);
      expect(prismaMock.gitSyncJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { environmentId: "env-1", status: "failed" },
          data: expect.objectContaining({
            status: "pending",
            attempts: 0,
          }),
        }),
      );
    });
  });

  // ─── retryJob ─────────────────────────────────────────────────────────────

  describe("retryJob", () => {
    it("retries a single failed job", async () => {
      prismaMock.gitSyncJob.findUnique.mockResolvedValue({
        status: "failed",
      } as never);
      prismaMock.gitSyncJob.update.mockResolvedValue({} as never);

      const result = await caller.retryJob({ jobId: "job-1" });

      expect(result.success).toBe(true);
    });

    it("throws BAD_REQUEST when job is not in failed state", async () => {
      prismaMock.gitSyncJob.findUnique.mockResolvedValue({
        status: "completed",
      } as never);

      await expect(
        caller.retryJob({ jobId: "job-1" }),
      ).rejects.toThrow("Job is not in failed state");
    });

    it("throws BAD_REQUEST when job does not exist", async () => {
      prismaMock.gitSyncJob.findUnique.mockResolvedValue(null);

      await expect(
        caller.retryJob({ jobId: "nonexistent" }),
      ).rejects.toThrow("Job is not in failed state");
    });
  });

  // ─── importErrors ─────────────────────────────────────────────────────────

  describe("importErrors", () => {
    it("returns import errors from audit log", async () => {
      prismaMock.auditLog.findMany.mockResolvedValue([
        {
          id: "log-1",
          metadata: { error: "YAML parse error", file: "pipeline.yaml" },
          createdAt: new Date(),
        },
      ] as never);

      const result = await caller.importErrors({ environmentId: "env-1" });

      expect(result).toHaveLength(1);
      expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            environmentId: "env-1",
            action: "gitops.pipeline.import_failed",
          },
        }),
      );
    });
  });
});
