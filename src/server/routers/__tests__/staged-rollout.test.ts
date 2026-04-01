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

import { prisma } from "@/lib/prisma";
import { stagedRolloutRouter } from "@/server/routers/staged-rollout";
import { stagedRolloutService } from "@/server/services/staged-rollout";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const stagedRolloutServiceMock = stagedRolloutService as unknown as {
  createRollout: ReturnType<typeof vi.fn>;
  broadenRollout: ReturnType<typeof vi.fn>;
  rollbackRollout: ReturnType<typeof vi.fn>;
};

const NOW = new Date("2026-03-01T12:00:00Z");

describe("stagedRolloutRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("creates a staged rollout", async () => {
      const caller = t.createCallerFactory(stagedRolloutRouter)({
        session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
        userRole: "ADMIN",
        teamId: "team-1",
      });

      stagedRolloutServiceMock.createRollout.mockResolvedValueOnce({ rolloutId: "rollout-1" });
      prismaMock.pipeline.findUnique.mockResolvedValueOnce({
        id: "pipe-1",
        environmentId: "env-1",
      } as never);

      const result = await caller.create({
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
      const callerNoUser = t.createCallerFactory(stagedRolloutRouter)({
        session: { user: { id: undefined, email: null, name: null } },
        userRole: "ADMIN",
        teamId: "team-1",
      });

      await expect(
        callerNoUser.create({
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
      const caller = t.createCallerFactory(stagedRolloutRouter)({
        session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
        userRole: "ADMIN",
        teamId: "team-1",
      });

      prismaMock.stagedRollout.findUnique.mockResolvedValueOnce({
        id: "rollout-1",
        pipelineId: "pipe-1",
        pipeline: { environmentId: "env-1" },
      } as never);
      stagedRolloutServiceMock.broadenRollout.mockResolvedValueOnce(undefined);

      const result = await caller.broaden({ rolloutId: "rollout-1" });

      expect(result).toEqual({ success: true });
      expect(stagedRolloutServiceMock.broadenRollout).toHaveBeenCalledWith("rollout-1");
    });
  });

  describe("rollback", () => {
    it("rolls back an active rollout", async () => {
      const caller = t.createCallerFactory(stagedRolloutRouter)({
        session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
        userRole: "ADMIN",
        teamId: "team-1",
      });

      prismaMock.stagedRollout.findUnique.mockResolvedValueOnce({
        id: "rollout-1",
        pipelineId: "pipe-1",
        pipeline: { environmentId: "env-1" },
      } as never);
      stagedRolloutServiceMock.rollbackRollout.mockResolvedValueOnce(undefined);

      const result = await caller.rollback({ rolloutId: "rollout-1" });

      expect(result).toEqual({ success: true });
      expect(stagedRolloutServiceMock.rollbackRollout).toHaveBeenCalledWith("rollout-1");
    });
  });

  describe("getActive", () => {
    it("returns the active rollout for a pipeline", async () => {
      const caller = t.createCallerFactory(stagedRolloutRouter)({
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
        createdBy: { name: "Test User", email: "test@test.com" },
        createdAt: NOW,
      };
      prismaMock.stagedRollout.findFirst.mockResolvedValueOnce(rollout as never);

      const result = await caller.getActive({ pipelineId: "pipe-1" });

      expect(result).toEqual(rollout);
      expect(prismaMock.stagedRollout.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            pipelineId: "pipe-1",
            status: { in: ["CANARY_DEPLOYED", "HEALTH_CHECK"] },
          },
        }),
      );
    });

    it("returns null when no active rollout exists", async () => {
      const caller = t.createCallerFactory(stagedRolloutRouter)({
        session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
        userRole: "ADMIN",
        teamId: "team-1",
      });

      prismaMock.stagedRollout.findFirst.mockResolvedValueOnce(null);

      const result = await caller.getActive({ pipelineId: "pipe-1" });

      expect(result).toBeNull();
    });
  });

  describe("list", () => {
    it("returns rollouts ordered desc with take 10", async () => {
      const caller = t.createCallerFactory(stagedRolloutRouter)({
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
          createdBy: { name: "Test User", email: "test@test.com" },
          createdAt: NOW,
        },
      ];
      prismaMock.stagedRollout.findMany.mockResolvedValueOnce(rollouts as never);

      const result = await caller.list({ pipelineId: "pipe-1" });

      expect(result).toEqual(rollouts);
      expect(prismaMock.stagedRollout.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { pipelineId: "pipe-1" },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
      );
    });
  });
});
