import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/webhook-delivery", () => ({
  deliverSingleWebhook: vi.fn(),
}));

vi.mock("@/server/services/channels", () => ({
  getDriver: vi.fn(),
}));

vi.mock("@/server/services/delivery-tracking", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/services/delivery-tracking")
  >();
  return {
    ...actual,
    trackWebhookDelivery: vi.fn(
      async (
        _alertEventId: string,
        _webhookId: string,
        _webhookName: string,
        deliverFn: () => Promise<{ success: boolean; error?: string }>,
      ) => {
        return deliverFn();
      },
    ),
    trackChannelDelivery: vi.fn(
      async (
        _alertEventId: string,
        _channelId: string,
        _channelType: string,
        _channelName: string,
        deliverFn: () => Promise<{ success: boolean; error?: string }>,
      ) => {
        return deliverFn();
      },
    ),
  };
});

import { prisma } from "@/lib/prisma";
import { RetryService } from "@/server/services/retry-service";
import { deliverSingleWebhook } from "@/server/services/webhook-delivery";
import { getDriver } from "@/server/services/channels";
import {
  trackWebhookDelivery,
  trackChannelDelivery,
} from "@/server/services/delivery-tracking";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const deliverSingleWebhookMock = vi.mocked(deliverSingleWebhook);
const getDriverMock = vi.mocked(getDriver);
const trackWebhookDeliveryMock = vi.mocked(trackWebhookDelivery);
const trackChannelDeliveryMock = vi.mocked(trackChannelDelivery);

// ─── Helpers ────────────────────────────────────────────────────────────────

const NOW = new Date("2025-06-01T12:00:00Z");
const PAST = new Date("2025-06-01T11:59:00Z");

function makeDueAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: "attempt-1",
    alertEventId: "evt-1",
    channelType: "legacy_webhook",
    channelName: "https://hooks.example.com",
    status: "failed",
    statusCode: 503,
    errorMessage: "Service Unavailable",
    attemptNumber: 1,
    nextRetryAt: PAST,
    webhookId: "wh-1",
    channelId: null,
    requestedAt: new Date("2025-06-01T11:58:00Z"),
    completedAt: new Date("2025-06-01T11:58:01Z"),
    ...overrides,
  };
}

function makeAlertEvent() {
  return {
    id: "evt-1",
    alertRuleId: "rule-1",
    nodeId: null,
    status: "firing",
    value: 85.5,
    message: "CPU usage exceeded threshold",
    firedAt: NOW,
    resolvedAt: null,
    notifiedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    alertRule: {
      id: "rule-1",
      name: "High CPU",
      enabled: true,
      environmentId: "env-1",
      pipelineId: null,
      teamId: "team-1",
      metric: "cpu_usage",
      condition: null,
      threshold: 80,
      durationSeconds: null,
      snoozedUntil: null,
      createdAt: NOW,
      updatedAt: NOW,
      environment: {
        name: "production",
        team: { name: "ops" },
      },
      pipeline: null,
    },
    node: null,
  };
}

function makeWebhook() {
  return {
    id: "wh-1",
    environmentId: "env-1",
    url: "https://hooks.example.com/alert",
    headers: null,
    hmacSecret: null,
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeChannel() {
  return {
    id: "ch-1",
    environmentId: "env-1",
    name: "#ops-alerts",
    type: "slack",
    config: { webhook_url: "https://hooks.slack.com/xxx" },
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("RetryService", () => {
  let service: RetryService;

  beforeEach(() => {
    mockReset(prismaMock);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    service = new RetryService();
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  // 1. processRetries finds due retries and creates new attempt records
  it("finds due retries and re-executes delivery via trackWebhookDelivery", async () => {
    const dueAttempt = makeDueAttempt();
    prismaMock.deliveryAttempt.findMany.mockResolvedValue([dueAttempt]);
    prismaMock.deliveryAttempt.update.mockResolvedValue(dueAttempt as never);
    prismaMock.alertEvent.findUnique.mockResolvedValue(makeAlertEvent() as never);
    prismaMock.alertWebhook.findUnique.mockResolvedValue(makeWebhook() as never);

    deliverSingleWebhookMock.mockResolvedValue({
      success: true,
      statusCode: 200,
    });
    trackWebhookDeliveryMock.mockResolvedValue({
      success: true,
      statusCode: 200,
    });

    await service.processRetries();

    // Should have queried for due retries
    expect(prismaMock.deliveryAttempt.findMany).toHaveBeenCalledWith({
      where: {
        status: "failed",
        nextRetryAt: { lte: expect.any(Date) },
        attemptNumber: { lt: 4 },
      },
      orderBy: { nextRetryAt: "asc" },
      take: 10,
    });

    // Should have claimed the record by nulling nextRetryAt
    expect(prismaMock.deliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: "attempt-1" },
      data: { nextRetryAt: null },
    });

    // Should have called trackWebhookDelivery with attemptNumber + 1
    expect(trackWebhookDeliveryMock).toHaveBeenCalledWith(
      "evt-1",
      "wh-1",
      "https://hooks.example.com/alert",
      expect.any(Function),
      2,
    );
  });

  // 2. Successful retry — original record's nextRetryAt nulled, no further retries
  it("nulls nextRetryAt on original record and does not schedule further on success", async () => {
    const dueAttempt = makeDueAttempt();
    prismaMock.deliveryAttempt.findMany.mockResolvedValue([dueAttempt]);
    prismaMock.deliveryAttempt.update.mockResolvedValue(dueAttempt as never);
    prismaMock.alertEvent.findUnique.mockResolvedValue(makeAlertEvent() as never);
    prismaMock.alertWebhook.findUnique.mockResolvedValue(makeWebhook() as never);

    trackWebhookDeliveryMock.mockResolvedValue({
      success: true,
      statusCode: 200,
    });

    await service.processRetries();

    // Original record claimed
    expect(prismaMock.deliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: "attempt-1" },
      data: { nextRetryAt: null },
    });

    // trackWebhookDelivery called once — success means no further action
    expect(trackWebhookDeliveryMock).toHaveBeenCalledTimes(1);
  });

  // 3. Failed retry — new attempt has nextRetryAt set per backoff (handled by trackDelivery)
  it("creates a new attempt via trackWebhookDelivery when retry fails", async () => {
    const dueAttempt = makeDueAttempt();
    prismaMock.deliveryAttempt.findMany.mockResolvedValue([dueAttempt]);
    prismaMock.deliveryAttempt.update.mockResolvedValue(dueAttempt as never);
    prismaMock.alertEvent.findUnique.mockResolvedValue(makeAlertEvent() as never);
    prismaMock.alertWebhook.findUnique.mockResolvedValue(makeWebhook() as never);

    trackWebhookDeliveryMock.mockResolvedValue({
      success: false,
      statusCode: 503,
      error: "Service Unavailable",
    });

    await service.processRetries();

    // trackWebhookDelivery is called with attemptNumber 2
    // The backoff scheduling for the new attempt is handled inside trackDelivery (T01)
    expect(trackWebhookDeliveryMock).toHaveBeenCalledWith(
      "evt-1",
      "wh-1",
      "https://hooks.example.com/alert",
      expect.any(Function),
      2,
    );
  });

  // 4. Max attempts (attemptNumber >= 4) — query excludes them, no retry
  it("does not pick up attempts with attemptNumber >= 4", async () => {
    // The query has attemptNumber: { lt: 4 }, so attempt 4 is excluded
    prismaMock.deliveryAttempt.findMany.mockResolvedValue([]);

    await service.processRetries();

    expect(prismaMock.deliveryAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          attemptNumber: { lt: 4 },
        }),
      }),
    );

    // No delivery calls
    expect(trackWebhookDeliveryMock).not.toHaveBeenCalled();
    expect(trackChannelDeliveryMock).not.toHaveBeenCalled();
  });

  // 5. Poll skips records with nextRetryAt in the future
  it("only selects records where nextRetryAt <= now", async () => {
    prismaMock.deliveryAttempt.findMany.mockResolvedValue([]);

    await service.processRetries();

    expect(prismaMock.deliveryAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          nextRetryAt: { lte: expect.any(Date) },
        }),
      }),
    );

    // Verify the lte date is close to NOW
    const callArgs = prismaMock.deliveryAttempt.findMany.mock.calls[0]![0];
    const lteDate = (callArgs as { where: { nextRetryAt: { lte: Date } } })
      .where.nextRetryAt.lte;
    expect(lteDate.getTime()).toBe(NOW.getTime());
  });

  // 6. Webhook retry resolves target via webhookId and calls deliverSingleWebhook
  it("resolves webhook target via webhookId and passes it to deliverSingleWebhook", async () => {
    const dueAttempt = makeDueAttempt({ webhookId: "wh-1", channelId: null });
    const webhook = makeWebhook();
    prismaMock.deliveryAttempt.findMany.mockResolvedValue([dueAttempt]);
    prismaMock.deliveryAttempt.update.mockResolvedValue(dueAttempt as never);
    prismaMock.alertEvent.findUnique.mockResolvedValue(makeAlertEvent() as never);
    prismaMock.alertWebhook.findUnique.mockResolvedValue(webhook as never);

    // Make trackWebhookDelivery actually call the deliverFn
    trackWebhookDeliveryMock.mockImplementation(
      async (_alertEventId, _webhookId, _name, deliverFn) => {
        return deliverFn();
      },
    );

    deliverSingleWebhookMock.mockResolvedValue({
      success: true,
      statusCode: 200,
    });

    await service.processRetries();

    // Should have looked up the webhook
    expect(prismaMock.alertWebhook.findUnique).toHaveBeenCalledWith({
      where: { id: "wh-1" },
    });

    // deliverSingleWebhook should have been called with the webhook and payload
    expect(deliverSingleWebhookMock).toHaveBeenCalledWith(
      webhook,
      expect.objectContaining({
        alertId: "evt-1",
        ruleName: "High CPU",
        environment: "production",
      }),
    );
  });

  // 7. Channel retry resolves target via channelId and calls channel driver
  it("resolves channel target via channelId and calls the channel driver", async () => {
    const dueAttempt = makeDueAttempt({
      webhookId: null,
      channelId: "ch-1",
      channelType: "slack",
      channelName: "#ops-alerts",
    });
    const channel = makeChannel();

    prismaMock.deliveryAttempt.findMany.mockResolvedValue([dueAttempt]);
    prismaMock.deliveryAttempt.update.mockResolvedValue(dueAttempt as never);
    prismaMock.alertEvent.findUnique.mockResolvedValue(makeAlertEvent() as never);
    prismaMock.notificationChannel.findUnique.mockResolvedValue(channel as never);

    const mockDriverDeliver = vi.fn().mockResolvedValue({
      channelId: "ch-1",
      success: true,
    });
    getDriverMock.mockReturnValue({
      deliver: mockDriverDeliver,
      test: vi.fn(),
    });

    // Make trackChannelDelivery actually call the deliverFn
    trackChannelDeliveryMock.mockImplementation(
      async (_alertEventId, _channelId, _type, _name, deliverFn) => {
        return deliverFn();
      },
    );

    await service.processRetries();

    // Should have looked up the channel
    expect(prismaMock.notificationChannel.findUnique).toHaveBeenCalledWith({
      where: { id: "ch-1" },
    });

    // trackChannelDelivery should have been called with channel details
    expect(trackChannelDeliveryMock).toHaveBeenCalledWith(
      "evt-1",
      "ch-1",
      "slack",
      "#ops-alerts",
      expect.any(Function),
      2,
    );

    // The driver's deliver should have been called
    expect(mockDriverDeliver).toHaveBeenCalledWith(
      channel.config,
      expect.objectContaining({
        alertId: "evt-1",
        ruleName: "High CPU",
      }),
    );
  });

  // 8. Individual retry errors don't crash the poll loop
  it("catches errors in individual retries and continues processing", async () => {
    const attempt1 = makeDueAttempt({ id: "attempt-1", webhookId: "wh-1" });
    const attempt2 = makeDueAttempt({
      id: "attempt-2",
      webhookId: "wh-2",
      alertEventId: "evt-2",
    });

    prismaMock.deliveryAttempt.findMany.mockResolvedValue([attempt1, attempt2]);
    prismaMock.deliveryAttempt.update.mockResolvedValue(attempt1 as never);

    // First attempt: buildPayload throws
    prismaMock.alertEvent.findUnique
      .mockRejectedValueOnce(new Error("DB connection lost"))
      .mockResolvedValueOnce(makeAlertEvent() as never);

    prismaMock.alertWebhook.findUnique.mockResolvedValue(makeWebhook() as never);
    trackWebhookDeliveryMock.mockResolvedValue({
      success: true,
      statusCode: 200,
    });

    // Should not throw
    await service.processRetries();

    // Second attempt should still have been processed
    // Both attempts should have had their nextRetryAt claimed
    expect(prismaMock.deliveryAttempt.update).toHaveBeenCalledTimes(2);
  });

  // ─── Lifecycle tests ────────────────────────────────────────────────────

  it("start() creates an interval that calls processRetries", () => {
    prismaMock.deliveryAttempt.findMany.mockResolvedValue([]);

    service.start();

    // Advance time by one poll interval
    vi.advanceTimersByTime(30_000);

    // processRetries should have been triggered
    expect(prismaMock.deliveryAttempt.findMany).toHaveBeenCalled();
  });

  it("stop() clears the interval", () => {
    prismaMock.deliveryAttempt.findMany.mockResolvedValue([]);

    service.start();
    service.stop();

    // Advance time — no calls should happen
    vi.advanceTimersByTime(60_000);

    expect(prismaMock.deliveryAttempt.findMany).not.toHaveBeenCalled();
  });

  it("skips retry when alertEvent is not found (deleted)", async () => {
    const dueAttempt = makeDueAttempt();
    prismaMock.deliveryAttempt.findMany.mockResolvedValue([dueAttempt]);
    prismaMock.deliveryAttempt.update.mockResolvedValue(dueAttempt as never);
    prismaMock.alertEvent.findUnique.mockResolvedValue(null);

    await service.processRetries();

    // Should not attempt delivery
    expect(trackWebhookDeliveryMock).not.toHaveBeenCalled();
    expect(trackChannelDeliveryMock).not.toHaveBeenCalled();
  });

  it("skips retry when webhook target is not found (deleted)", async () => {
    const dueAttempt = makeDueAttempt({ webhookId: "wh-deleted" });
    prismaMock.deliveryAttempt.findMany.mockResolvedValue([dueAttempt]);
    prismaMock.deliveryAttempt.update.mockResolvedValue(dueAttempt as never);
    prismaMock.alertEvent.findUnique.mockResolvedValue(makeAlertEvent() as never);
    prismaMock.alertWebhook.findUnique.mockResolvedValue(null);

    await service.processRetries();

    expect(trackWebhookDeliveryMock).not.toHaveBeenCalled();
  });

  it("skips retry when channel target is not found (deleted)", async () => {
    const dueAttempt = makeDueAttempt({
      webhookId: null,
      channelId: "ch-deleted",
    });
    prismaMock.deliveryAttempt.findMany.mockResolvedValue([dueAttempt]);
    prismaMock.deliveryAttempt.update.mockResolvedValue(dueAttempt as never);
    prismaMock.alertEvent.findUnique.mockResolvedValue(makeAlertEvent() as never);
    prismaMock.notificationChannel.findUnique.mockResolvedValue(null);

    await service.processRetries();

    expect(trackChannelDeliveryMock).not.toHaveBeenCalled();
  });
});
