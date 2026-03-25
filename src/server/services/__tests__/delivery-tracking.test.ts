import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// Mock prisma — vi.mock is hoisted; the factory returns our deep mock.
vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import {
  trackDelivery,
  trackWebhookDelivery,
  trackChannelDelivery,
  type DeliveryResult,
} from "@/server/services/delivery-tracking";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// ─── Helpers ────────────────────────────────────────────────────────────────

const ALERT_EVENT_ID = "evt-1";
const ATTEMPT_ID = "attempt-1";

function mockCreateAttempt() {
  prismaMock.deliveryAttempt.create.mockResolvedValue({
    id: ATTEMPT_ID,
    alertEventId: ALERT_EVENT_ID,
    channelType: "slack",
    channelName: "#alerts",
    status: "pending",
    statusCode: null,
    errorMessage: null,
    requestedAt: new Date("2025-06-01T12:00:00Z"),
    completedAt: null,
  });
}

function mockUpdateAttempt() {
  prismaMock.deliveryAttempt.update.mockResolvedValue({
    id: ATTEMPT_ID,
    alertEventId: ALERT_EVENT_ID,
    channelType: "slack",
    channelName: "#alerts",
    status: "success",
    statusCode: 200,
    errorMessage: null,
    requestedAt: new Date("2025-06-01T12:00:00Z"),
    completedAt: new Date("2025-06-01T12:00:01Z"),
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("trackDelivery", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a pending record, executes delivery, and updates to success", async () => {
    mockCreateAttempt();
    mockUpdateAttempt();

    const deliverFn = vi.fn<() => Promise<DeliveryResult>>().mockResolvedValue({
      success: true,
      statusCode: 200,
    });

    const result = await trackDelivery({
      alertEventId: ALERT_EVENT_ID,
      channelType: "slack",
      channelName: "#alerts",
      deliverFn,
    });

    // Pending record created first
    expect(prismaMock.deliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        alertEventId: ALERT_EVENT_ID,
        channelType: "slack",
        channelName: "#alerts",
        status: "pending",
      }),
    });

    // Delivery function invoked
    expect(deliverFn).toHaveBeenCalledOnce();

    // Updated to success
    expect(prismaMock.deliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: ATTEMPT_ID },
      data: expect.objectContaining({
        status: "success",
        statusCode: 200,
        errorMessage: null,
      }),
    });

    expect(result).toEqual({ success: true, statusCode: 200 });
  });

  it("updates to failed with statusCode and errorMessage on HTTP error", async () => {
    mockCreateAttempt();
    mockUpdateAttempt();

    const deliverFn = vi.fn<() => Promise<DeliveryResult>>().mockResolvedValue({
      success: false,
      statusCode: 502,
      error: "Bad Gateway",
    });

    const result = await trackDelivery({
      alertEventId: ALERT_EVENT_ID,
      channelType: "email",
      channelName: "ops@company.com",
      deliverFn,
    });

    expect(prismaMock.deliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: ATTEMPT_ID },
      data: expect.objectContaining({
        status: "failed",
        statusCode: 502,
        errorMessage: "Bad Gateway",
      }),
    });

    expect(result).toEqual({
      success: false,
      statusCode: 502,
      error: "Bad Gateway",
    });
  });

  it("updates to failed with error message when delivery throws an exception", async () => {
    mockCreateAttempt();
    mockUpdateAttempt();

    const deliverFn = vi
      .fn<() => Promise<DeliveryResult>>()
      .mockRejectedValue(new Error("Connection refused"));

    const result = await trackDelivery({
      alertEventId: ALERT_EVENT_ID,
      channelType: "pagerduty",
      channelName: "Ops On-Call",
      deliverFn,
    });

    expect(prismaMock.deliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: ATTEMPT_ID },
      data: expect.objectContaining({
        status: "failed",
        errorMessage: "Connection refused",
      }),
    });

    expect(result).toEqual({ success: false, error: "Connection refused" });
  });

  it("records correct channelType and channelName", async () => {
    mockCreateAttempt();
    mockUpdateAttempt();

    const deliverFn = vi.fn<() => Promise<DeliveryResult>>().mockResolvedValue({
      success: true,
      statusCode: 200,
    });

    await trackDelivery({
      alertEventId: ALERT_EVENT_ID,
      channelType: "webhook",
      channelName: "https://hooks.example.com/alert",
      deliverFn,
    });

    expect(prismaMock.deliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channelType: "webhook",
        channelName: "https://hooks.example.com/alert",
      }),
    });
  });

  it("sets requestedAt before delivery and completedAt after", async () => {
    mockCreateAttempt();
    mockUpdateAttempt();

    const deliverFn = vi.fn<() => Promise<DeliveryResult>>().mockResolvedValue({
      success: true,
      statusCode: 200,
    });

    await trackDelivery({
      alertEventId: ALERT_EVENT_ID,
      channelType: "slack",
      channelName: "#alerts",
      deliverFn,
    });

    // requestedAt is passed at create time
    const createCall = prismaMock.deliveryAttempt.create.mock.calls[0]![0];
    expect(createCall.data.requestedAt).toBeInstanceOf(Date);

    // completedAt is set in the update
    const updateCall = prismaMock.deliveryAttempt.update.mock.calls[0]![0];
    expect(updateCall.data.completedAt).toBeInstanceOf(Date);
  });
});

// ─── Convenience wrappers ───────────────────────────────────────────────────

describe("trackWebhookDelivery", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("delegates to trackDelivery with channelType 'legacy_webhook'", async () => {
    mockCreateAttempt();
    mockUpdateAttempt();

    const deliverFn = vi.fn<() => Promise<DeliveryResult>>().mockResolvedValue({
      success: true,
      statusCode: 200,
    });

    await trackWebhookDelivery(
      ALERT_EVENT_ID,
      "webhook-1",
      "https://hooks.example.com",
      deliverFn,
    );

    expect(prismaMock.deliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channelType: "legacy_webhook",
        channelName: "https://hooks.example.com",
      }),
    });

    expect(deliverFn).toHaveBeenCalledOnce();
  });
});

describe("trackChannelDelivery", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("delegates to trackDelivery with the specified channelType and channelName", async () => {
    mockCreateAttempt();
    mockUpdateAttempt();

    const deliverFn = vi.fn<() => Promise<DeliveryResult>>().mockResolvedValue({
      success: true,
      statusCode: 200,
    });

    await trackChannelDelivery(
      ALERT_EVENT_ID,
      "channel-1",
      "slack",
      "#ops-alerts",
      deliverFn,
    );

    expect(prismaMock.deliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channelType: "slack",
        channelName: "#ops-alerts",
      }),
    });

    expect(deliverFn).toHaveBeenCalledOnce();
  });
});
