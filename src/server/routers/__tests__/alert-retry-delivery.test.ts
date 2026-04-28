import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import { TRPCError } from "@trpc/server";

// ─── vi.hoisted so mock fns and `t` are available inside vi.mock factories ──

const {
  t,
  mockTrackChannelDelivery,
  mockGetNextRetryAt,
  mockChannelDeliver,
} = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return {
    t,
    mockTrackChannelDelivery: vi.fn().mockResolvedValue({ success: true }),
    mockGetNextRetryAt: vi.fn().mockReturnValue(new Date()),
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
  getNextRetryAt: mockGetNextRetryAt,
}));

vi.mock("@/server/services/channels", () => ({
  getDriver: vi.fn().mockReturnValue({
    deliver: mockChannelDeliver,
  }),
}));

vi.mock("@/server/services/url-validation", () => ({
  validatePublicUrl: vi.fn().mockResolvedValue(undefined),
  validateSmtpHost: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/event-alerts", () => ({
  isEventMetric: vi.fn().mockReturnValue(false),
}));

vi.mock("@/server/services/alert-evaluator", () => ({
  FLEET_METRICS: [],
}));

// ─── Import SUT + mocks after vi.mock ───────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { alertRouter } from "@/server/routers/alert";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(alertRouter)({
  session: { user: { id: "user-1" } },
});

// ─── Helpers ────────────────────────────────────────────────────────────────

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
    requestedAt: new Date(),
    completedAt: new Date(),
    nextRetryAt: null,
    alertEvent: {
      id: "ae-1",
      status: "firing",
      value: 95,
      message: "CPU threshold exceeded",
      firedAt: new Date(),
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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("alert.retryDelivery", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  it("should throw NOT_FOUND if delivery attempt does not exist", async () => {
    prismaMock.deliveryAttempt.findUnique.mockResolvedValue(null);

    await expect(
      caller.retryDelivery({ deliveryAttemptId: "da-missing" }),
    ).rejects.toThrow(TRPCError);

    await expect(
      caller.retryDelivery({ deliveryAttemptId: "da-missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("should throw BAD_REQUEST if delivery is not in failed status", async () => {
    prismaMock.deliveryAttempt.findUnique.mockResolvedValue(
      makeDeliveryAttempt({ status: "success" }) as never,
    );

    await expect(
      caller.retryDelivery({ deliveryAttemptId: "da-1" }),
    ).rejects.toThrow(TRPCError);

    await expect(
      caller.retryDelivery({ deliveryAttemptId: "da-1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("should retry a failed channel delivery", async () => {
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

  it("should throw NOT_FOUND if channel target is not found", async () => {
    prismaMock.deliveryAttempt.findUnique.mockResolvedValue(
      makeDeliveryAttempt() as never,
    );
    prismaMock.notificationChannel.findUnique.mockResolvedValue(null);

    await expect(
      caller.retryDelivery({ deliveryAttemptId: "da-1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("should throw BAD_REQUEST if delivery has no target channel", async () => {
    prismaMock.deliveryAttempt.findUnique.mockResolvedValue(
      makeDeliveryAttempt({ channelId: null }) as never,
    );

    await expect(
      caller.retryDelivery({ deliveryAttemptId: "da-1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
