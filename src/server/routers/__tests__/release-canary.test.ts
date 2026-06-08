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
    requirePlatformOperator: passthrough,
    denyInDemo: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/server/middleware/audit", () => ({
  withAudit: () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx })),
}));

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

vi.mock("@/server/services/staged-rollout", () => ({
  stagedRolloutService: {
    createRollout: vi.fn(),
    broadenRollout: vi.fn(),
    rollbackRollout: vi.fn(),
  },
}));

vi.mock("@/server/services/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/server/services/lake/replay", () => ({
  getReplayJob: vi.fn(),
}));

vi.mock("@/server/services/lake/replay-validation", () => ({
  evaluateReplayValidation: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { canaryReleaseRouter } from "@/server/routers/release/canary";
import { stagedRolloutService } from "@/server/services/staged-rollout";
import { getReplayJob } from "@/server/services/lake/replay";
import { evaluateReplayValidation } from "@/server/services/lake/replay-validation";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const stagedRolloutServiceMock = stagedRolloutService as unknown as {
  createRollout: ReturnType<typeof vi.fn>;
  broadenRollout: ReturnType<typeof vi.fn>;
  rollbackRollout: ReturnType<typeof vi.fn>;
};

const NOW = new Date("2026-03-01T12:00:00Z");

const appRouter = t.router({ release: t.router({ canary: canaryReleaseRouter }) });

describe("release.canary router", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("creates a staged rollout", async () => {
      const caller = t.createCallerFactory(appRouter)({
        session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
        userRole: "ADMIN",
        teamId: "team-1",
      });

      stagedRolloutServiceMock.createRollout.mockResolvedValueOnce({ rolloutId: "rollout-1" });
      prismaMock.pipeline.findUnique.mockResolvedValueOnce({
        id: "pipe-1",
        environmentId: "env-1",
      } as never);

      const result = await caller.release.canary.create({
        pipelineId: "pipe-1",
        canarySelector: { region: "us-east-1" },
        healthCheckWindowMinutes: 5,
        changelog: "test deploy",
      });

      expect(result).toEqual({ rolloutId: "rollout-1" });
      expect(stagedRolloutServiceMock.createRollout).toHaveBeenCalledWith(
        "pipe-1",
        "user-1",
        { region: "us-east-1" },
        5,
        "test deploy",
      );
    });

    it("throws UNAUTHORIZED when session has no userId", async () => {
      const callerNoUser = t.createCallerFactory(appRouter)({
        session: { user: { id: undefined, email: null, name: null } },
        userRole: "ADMIN",
        teamId: "team-1",
      });

      await expect(
        callerNoUser.release.canary.create({
          pipelineId: "pipe-1",
          canarySelector: { region: "us-east-1" },
          healthCheckWindowMinutes: 5,
          changelog: "test",
        }),
      ).rejects.toThrow("UNAUTHORIZED");
    });
  });

  describe("broaden", () => {
    it("broadens an active rollout", async () => {
      const caller = t.createCallerFactory(appRouter)({
        session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
        userRole: "ADMIN",
        teamId: "team-1",
      });

      prismaMock.release.findFirst.mockResolvedValueOnce({
        id: "rollout-1",
        pipelineId: "pipe-1",
        pipeline: { environmentId: "env-1" },
      } as never);
      stagedRolloutServiceMock.broadenRollout.mockResolvedValueOnce(undefined);

      const result = await caller.release.canary.broaden({ rolloutId: "rollout-1" });

      expect(result).toEqual({ success: true });
      expect(stagedRolloutServiceMock.broadenRollout).toHaveBeenCalledWith("rollout-1");
    });

    it("blocks the broaden when replay validation FAILs and force is not set", async () => {
      const caller = t.createCallerFactory(appRouter)({
        session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
        userRole: "ADMIN",
        teamId: "team-1",
      });

      prismaMock.release.findFirst.mockResolvedValueOnce({
        id: "rollout-1",
        pipelineId: "pipe-1",
        pipeline: { environmentId: "env-1" },
      } as never);
      vi.mocked(getReplayJob).mockResolvedValueOnce({
        id: "job-1",
        targetPipelineId: "pipe-1",
        startedAt: NOW,
        completedAt: NOW,
      } as never);
      vi.mocked(evaluateReplayValidation).mockResolvedValueOnce({
        verdict: "FAIL",
        slis: [{ metric: "error_rate", status: "breached", value: 0.2, threshold: 0.05, condition: "lt" }],
        window: { from: NOW.toISOString(), to: NOW.toISOString() },
      });

      await expect(
        caller.release.canary.broaden({ rolloutId: "rollout-1", replayJobId: "job-1" }),
      ).rejects.toThrow(/Replay validation failed/);
      expect(stagedRolloutServiceMock.broadenRollout).not.toHaveBeenCalled();
    });

    it("allows a forced broaden over a FAILed validation and records the override", async () => {
      const caller = t.createCallerFactory(appRouter)({
        session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
        userRole: "ADMIN",
        teamId: "team-1",
      });

      prismaMock.release.findFirst.mockResolvedValueOnce({
        id: "rollout-1",
        pipelineId: "pipe-1",
        pipeline: { environmentId: "env-1" },
      } as never);
      vi.mocked(getReplayJob).mockResolvedValueOnce({
        id: "job-1",
        targetPipelineId: "pipe-1",
        startedAt: NOW,
        completedAt: NOW,
      } as never);
      vi.mocked(evaluateReplayValidation).mockResolvedValueOnce({
        verdict: "FAIL",
        slis: [{ metric: "error_rate", status: "breached", value: 0.2, threshold: 0.05, condition: "lt" }],
        window: { from: NOW.toISOString(), to: NOW.toISOString() },
      });
      stagedRolloutServiceMock.broadenRollout.mockResolvedValueOnce(undefined);

      const result = await caller.release.canary.broaden({
        rolloutId: "rollout-1",
        replayJobId: "job-1",
        force: true,
      });

      expect(result).toEqual({ success: true, replayValidation: { verdict: "FAIL", overridden: true } });
      expect(stagedRolloutServiceMock.broadenRollout).toHaveBeenCalledWith("rollout-1");
    });

    it("broadens when replay validation PASSes and records the verdict", async () => {
      const caller = t.createCallerFactory(appRouter)({
        session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
        userRole: "ADMIN",
        teamId: "team-1",
      });

      prismaMock.release.findFirst.mockResolvedValueOnce({
        id: "rollout-1",
        pipelineId: "pipe-1",
        pipeline: { environmentId: "env-1" },
      } as never);
      vi.mocked(getReplayJob).mockResolvedValueOnce({
        id: "job-1",
        targetPipelineId: "pipe-1",
        startedAt: NOW,
        completedAt: NOW,
      } as never);
      vi.mocked(evaluateReplayValidation).mockResolvedValueOnce({
        verdict: "PASS",
        slis: [{ metric: "error_rate", status: "met", value: 0.0, threshold: 0.05, condition: "lt" }],
        window: { from: NOW.toISOString(), to: NOW.toISOString() },
      });
      stagedRolloutServiceMock.broadenRollout.mockResolvedValueOnce(undefined);

      const result = await caller.release.canary.broaden({ rolloutId: "rollout-1", replayJobId: "job-1" });

      expect(result).toEqual({ success: true, replayValidation: { verdict: "PASS", overridden: false } });
      expect(stagedRolloutServiceMock.broadenRollout).toHaveBeenCalledWith("rollout-1");
    });

    it("rejects a replay job that targets a different pipeline", async () => {
      const caller = t.createCallerFactory(appRouter)({
        session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
        userRole: "ADMIN",
        teamId: "team-1",
      });

      prismaMock.release.findFirst.mockResolvedValueOnce({
        id: "rollout-1",
        pipelineId: "pipe-1",
        pipeline: { environmentId: "env-1" },
      } as never);
      vi.mocked(getReplayJob).mockResolvedValueOnce({
        id: "job-1",
        targetPipelineId: "other-pipe",
        startedAt: NOW,
        completedAt: NOW,
      } as never);

      await expect(
        caller.release.canary.broaden({ rolloutId: "rollout-1", replayJobId: "job-1" }),
      ).rejects.toThrow(/does not target this rollout/);
      expect(vi.mocked(evaluateReplayValidation)).not.toHaveBeenCalled();
      expect(stagedRolloutServiceMock.broadenRollout).not.toHaveBeenCalled();
    });
  });

  describe("rollback", () => {
    it("rolls back an active rollout", async () => {
      const caller = t.createCallerFactory(appRouter)({
        session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
        userRole: "ADMIN",
        teamId: "team-1",
      });

      prismaMock.release.findFirst.mockResolvedValueOnce({
        id: "rollout-1",
        pipelineId: "pipe-1",
        pipeline: { environmentId: "env-1" },
      } as never);
      stagedRolloutServiceMock.rollbackRollout.mockResolvedValueOnce(undefined);

      const result = await caller.release.canary.rollback({ rolloutId: "rollout-1" });

      expect(result).toEqual({ success: true });
      expect(stagedRolloutServiceMock.rollbackRollout).toHaveBeenCalledWith("rollout-1");
    });
  });

  describe("getActive", () => {
    it("returns the active rollout for a pipeline", async () => {
      const caller = t.createCallerFactory(appRouter)({
        session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
        userRole: "ADMIN",
        teamId: "team-1",
      });

      const rollout = {
        id: "rollout-1",
        pipelineId: "pipe-1",
        status: "CANARY_DEPLOYED",
        canaryVersion: { id: "v-2", version: 2, changelog: "new deploy" },
        previousVersion: { id: "v-1", version: 1 },
        requestedBy: { name: "Test User", email: "test@test.com" },
        createdAt: NOW,
      };
      prismaMock.release.findFirst.mockResolvedValueOnce(rollout as never);

      const result = await caller.release.canary.getActive({ pipelineId: "pipe-1" });

      expect(result).toEqual(rollout);
      expect(prismaMock.release.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            strategy: "CANARY",
            pipelineId: "pipe-1",
            status: { in: ["CANARY_DEPLOYED", "HEALTH_CHECK"] },
          },
        }),
      );
    });

    it("returns null when no active rollout exists", async () => {
      const caller = t.createCallerFactory(appRouter)({
        session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
        userRole: "ADMIN",
        teamId: "team-1",
      });

      prismaMock.release.findFirst.mockResolvedValueOnce(null);

      const result = await caller.release.canary.getActive({ pipelineId: "pipe-1" });

      expect(result).toBeNull();
    });
  });

  describe("list", () => {
    it("returns rollouts ordered desc with take 10", async () => {
      const caller = t.createCallerFactory(appRouter)({
        session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
        userRole: "ADMIN",
        teamId: "team-1",
      });

      const rollouts = [
        {
          id: "rollout-1",
          pipelineId: "pipe-1",
          status: "COMPLETED",
          canaryVersion: { id: "v-2", version: 2, changelog: "deploy" },
          previousVersion: { id: "v-1", version: 1 },
          requestedBy: { name: "Test User", email: "test@test.com" },
          createdAt: NOW,
        },
      ];
      prismaMock.release.findMany.mockResolvedValueOnce(rollouts as never);

      const result = await caller.release.canary.list({ pipelineId: "pipe-1" });

      expect(result).toEqual(rollouts);
      expect(prismaMock.release.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { pipelineId: "pipe-1", strategy: "CANARY" },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
      );
    });
  });
});
