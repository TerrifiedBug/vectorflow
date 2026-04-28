import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const {
  t,
  mockTrackChannelDelivery,
  mockChannelDeliver,
} = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return {
    t,
    mockTrackChannelDelivery: vi.fn().mockResolvedValue({ success: true }),
    mockChannelDeliver: vi.fn().mockResolvedValue({ success: true }),
  };
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

vi.mock("@/server/services/delivery-tracking", () => ({
  trackChannelDelivery: mockTrackChannelDelivery,
}));

vi.mock("@/server/services/channels", () => ({
  getDriver: vi.fn().mockReturnValue({
    deliver: mockChannelDeliver,
  }),
}));

import { prisma } from "@/lib/prisma";
import { alertDeliveriesRouter } from "@/server/routers/alert-deliveries";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(alertDeliveriesRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

function makeDeliveryAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: "da-1",
    status: "failed",
    alertEventId: "ae-1",
    channelId: "ch-1",
    channelType: "slack",
    channelName: "Test Channel",
    attemptNumber: 1,
    statusCode: 500,
    errorMessage: "Connection refused",
    requestedAt: new Date("2025-01-01"),
    completedAt: new Date("2025-01-01"),
    nextRetryAt: null,
    alertEvent: {
      id: "ae-1",
      status: "firing",
      value: 95,
      message: "CPU threshold exceeded",
      firedAt: new Date("2025-01-01"),
      alertRule: {
        name: "High CPU",
        metric: "cpu_usage",
        threshold: 90,
        environment: {
          name: "production",
          team: { name: "Platform" },
        },
        pipeline: { name: "metrics-pipeline" },
      },
      node: { host: "node-1" },
    },
    ...overrides,
  };
}

describe("alertDeliveriesRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ─── listDeliveries ────────────────────────────────────────────────────────

  describe("listDeliveries", () => {
    it("returns delivery attempts for an alert event", async () => {
      const deliveries = [
        {
          id: "da-1",
          channelType: "slack",
          channelName: "alerts",
          status: "success",
          statusCode: 200,
          errorMessage: null,
          requestedAt: new Date("2025-01-01"),
          completedAt: new Date("2025-01-01"),
          attemptNumber: 1,
        },
      ];
      prismaMock.deliveryAttempt.findMany.mockResolvedValue(deliveries as never);

      const result = await caller.listDeliveries({ alertEventId: "ae-1" });

      expect(result).toHaveLength(1);
      expect(result[0].channelType).toBe("slack");
    });

    it("returns empty array when no deliveries exist", async () => {
      prismaMock.deliveryAttempt.findMany.mockResolvedValue([]);

      const result = await caller.listDeliveries({ alertEventId: "ae-1" });

      expect(result).toEqual([]);
    });
  });

  // ─── listChannelDeliveries ─────────────────────────────────────────────────

  describe("listChannelDeliveries", () => {
    it("returns deliveries filtered by channel", async () => {
      const deliveries = [
        {
          id: "da-1",
          channelType: "slack",
          channelName: "alerts",
          status: "success",
          statusCode: 200,
          errorMessage: null,
          requestedAt: new Date("2025-01-01"),
          completedAt: new Date("2025-01-01"),
          attemptNumber: 1,
        },
      ];
      prismaMock.deliveryAttempt.findMany.mockResolvedValue(deliveries as never);

      const result = await caller.listChannelDeliveries({
        environmentId: "env-1",
        channelName: "alerts",
        channelType: "slack",
        limit: 10,
      });

      expect(result).toHaveLength(1);
      expect(prismaMock.deliveryAttempt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            channelName: "alerts",
            channelType: "slack",
          }),
          take: 10,
        }),
      );
    });
  });

  // ─── retryDelivery ─────────────────────────────────────────────────────────

  describe("retryDelivery", () => {
    it("throws NOT_FOUND if delivery attempt does not exist", async () => {
      prismaMock.deliveryAttempt.findUnique.mockResolvedValue(null);

      await expect(
        caller.retryDelivery({ deliveryAttemptId: "da-missing" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws BAD_REQUEST if delivery is not in failed status", async () => {
      prismaMock.deliveryAttempt.findUnique.mockResolvedValue(
        makeDeliveryAttempt({ status: "success" }) as never,
      );

      await expect(
        caller.retryDelivery({ deliveryAttemptId: "da-1" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("retries a failed channel delivery", async () => {
      prismaMock.deliveryAttempt.findUnique.mockResolvedValue(
        makeDeliveryAttempt() as never,
      );
      prismaMock.notificationChannel.findUnique.mockResolvedValue({
        id: "ch-1",
        environmentId: "env-1",
        name: "Test Channel",
        type: "slack",
        config: { webhookUrl: "https://hooks.slack.com/test" },
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      const result = await caller.retryDelivery({ deliveryAttemptId: "da-1" });

      expect(result).toEqual({ success: true });
      expect(mockTrackChannelDelivery).toHaveBeenCalledWith(
        "ae-1",
        "ch-1",
        "slack",
        "Test Channel",
        expect.any(Function),
        2,
      );
    });

    it("throws NOT_FOUND if channel target is not found", async () => {
      prismaMock.deliveryAttempt.findUnique.mockResolvedValue(
        makeDeliveryAttempt() as never,
      );
      prismaMock.notificationChannel.findUnique.mockResolvedValue(null);

      await expect(
        caller.retryDelivery({ deliveryAttemptId: "da-1" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws BAD_REQUEST if delivery has no target channel", async () => {
      prismaMock.deliveryAttempt.findUnique.mockResolvedValue(
        makeDeliveryAttempt({ channelId: null }) as never,
      );

      await expect(
        caller.retryDelivery({ deliveryAttemptId: "da-1" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("throws NOT_FOUND if associated alert event or rule not found", async () => {
      prismaMock.deliveryAttempt.findUnique.mockResolvedValue(
        makeDeliveryAttempt({ alertEvent: { id: "ae-1", alertRule: null } }) as never,
      );

      await expect(
        caller.retryDelivery({ deliveryAttemptId: "da-1" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ─── listFailedDeliveries ──────────────────────────────────────────────────

  describe("listFailedDeliveries", () => {
    it("returns failed delivery attempts for an environment", async () => {
      const deliveries = [
        {
          id: "da-1",
          channelType: "slack",
          channelName: "alerts",
          status: "failed",
          statusCode: 500,
          errorMessage: "Server error",
          requestedAt: new Date("2025-01-01"),
          completedAt: new Date("2025-01-01"),
          attemptNumber: 1,
          alertEventId: "ae-1",
          alertEvent: { alertRule: { name: "CPU Alert" } },
        },
      ];
      prismaMock.deliveryAttempt.findMany.mockResolvedValue(deliveries as never);

      const result = await caller.listFailedDeliveries({
        environmentId: "env-1",
        limit: 50,
      });

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("failed");
    });
  });

  // ─── retryAllForChannel ────────────────────────────────────────────────────

  describe("retryAllForChannel", () => {
    it("marks failed deliveries for retry and returns count", async () => {
      prismaMock.deliveryAttempt.findMany.mockResolvedValue([
        { id: "da-1" },
        { id: "da-2" },
      ] as never);
      prismaMock.deliveryAttempt.updateMany.mockResolvedValue({ count: 2 } as never);

      const result = await caller.retryAllForChannel({
        channelName: "alerts",
        channelType: "slack",
        environmentId: "env-1",
      });

      expect(result.retriedCount).toBe(2);
      expect(prismaMock.deliveryAttempt.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ["da-1", "da-2"] } },
        }),
      );
    });

    it("returns zero count when no failed deliveries exist", async () => {
      prismaMock.deliveryAttempt.findMany.mockResolvedValue([]);

      const result = await caller.retryAllForChannel({
        channelName: "alerts",
        channelType: "slack",
        environmentId: "env-1",
      });

      expect(result.retriedCount).toBe(0);
      expect(prismaMock.deliveryAttempt.updateMany).not.toHaveBeenCalled();
    });
  });
});
