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
  trackChannelDelivery,
  getNextRetryAt,
  BACKOFF_DELAYS,
  type DeliveryResult,
} from "@/server/services/delivery-tracking";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// ─── Helpers ────────────────────────────────────────────────────────────────

const ALERT_EVENT_ID = "evt-1";
const ATTEMPT_ID = "attempt-1";

function mockCreateAttempt(overrides: Record<string, unknown> = {}) {
  prismaMock.deliveryAttempt.create.mockResolvedValue({
    id: ATTEMPT_ID,
    alertEventId: ALERT_EVENT_ID,
    channelType: "slack",
    channelName: "#alerts",
    status: "pending",
    statusCode: null,
    errorMessage: null,
    attemptNumber: 1,
    nextRetryAt: null,
    channelId: null,
    requestedAt: new Date("2025-06-01T12:00:00Z"),
    completedAt: null,
    ...overrides,
  });
}

function mockUpdateAttempt(overrides: Record<string, unknown> = {}) {
  prismaMock.deliveryAttempt.update.mockResolvedValue({
    id: ATTEMPT_ID,
    alertEventId: ALERT_EVENT_ID,
    channelType: "slack",
    channelName: "#alerts",
    status: "success",
    statusCode: 200,
    errorMessage: null,
    attemptNumber: 1,
    nextRetryAt: null,
    channelId: null,
    requestedAt: new Date("2025-06-01T12:00:00Z"),
    completedAt: new Date("2025-06-01T12:00:01Z"),
    ...overrides,
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
        attemptNumber: 1,
        channelId: null,
      }),
    });

    // Delivery function invoked
    expect(deliverFn).toHaveBeenCalledOnce();

    // Updated to success with no nextRetryAt
    expect(prismaMock.deliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: ATTEMPT_ID },
      data: expect.objectContaining({
        status: "success",
        statusCode: 200,
        errorMessage: null,
        nextRetryAt: null,
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

  // ─── Retry scheduling tests ─────────────────────────────────────────────

  it("sets nextRetryAt on failure for attempt 1 (30s backoff)", async () => {
    mockCreateAttempt();
    mockUpdateAttempt();

    const deliverFn = vi.fn<() => Promise<DeliveryResult>>().mockResolvedValue({
      success: false,
      statusCode: 503,
      error: "Service Unavailable",
    });

    await trackDelivery({
      alertEventId: ALERT_EVENT_ID,
      channelType: "slack",
      channelName: "#alerts",
      deliverFn,
      attemptNumber: 1,
    });

    const updateCall = prismaMock.deliveryAttempt.update.mock.calls[0]![0];
    const nextRetryAt = updateCall.data.nextRetryAt as Date;
    expect(nextRetryAt).toBeInstanceOf(Date);
    expect(nextRetryAt.getTime()).toBe(
      new Date("2025-06-01T12:00:00Z").getTime() + 30_000,
    );
  });

  it("sets nextRetryAt on failure for attempt 2 (120s backoff)", async () => {
    mockCreateAttempt({ attemptNumber: 2 });
    mockUpdateAttempt();

    const deliverFn = vi.fn<() => Promise<DeliveryResult>>().mockResolvedValue({
      success: false,
      statusCode: 503,
      error: "Service Unavailable",
    });

    await trackDelivery({
      alertEventId: ALERT_EVENT_ID,
      channelType: "slack",
      channelName: "#alerts",
      deliverFn,
      attemptNumber: 2,
    });

    const updateCall = prismaMock.deliveryAttempt.update.mock.calls[0]![0];
    const nextRetryAt = updateCall.data.nextRetryAt as Date;
    expect(nextRetryAt).toBeInstanceOf(Date);
    expect(nextRetryAt.getTime()).toBe(
      new Date("2025-06-01T12:00:00Z").getTime() + 120_000,
    );
  });

  it("sets nextRetryAt on failure for attempt 3 (600s backoff)", async () => {
    mockCreateAttempt({ attemptNumber: 3 });
    mockUpdateAttempt();

    const deliverFn = vi.fn<() => Promise<DeliveryResult>>().mockResolvedValue({
      success: false,
      statusCode: 503,
      error: "Service Unavailable",
    });

    await trackDelivery({
      alertEventId: ALERT_EVENT_ID,
      channelType: "slack",
      channelName: "#alerts",
      deliverFn,
      attemptNumber: 3,
    });

    const updateCall = prismaMock.deliveryAttempt.update.mock.calls[0]![0];
    const nextRetryAt = updateCall.data.nextRetryAt as Date;
    expect(nextRetryAt).toBeInstanceOf(Date);
    expect(nextRetryAt.getTime()).toBe(
      new Date("2025-06-01T12:00:00Z").getTime() + 600_000,
    );
  });

  it("sets nextRetryAt to null for attempt 4+ (max retries exceeded)", async () => {
    mockCreateAttempt({ attemptNumber: 4 });
    mockUpdateAttempt();

    const deliverFn = vi.fn<() => Promise<DeliveryResult>>().mockResolvedValue({
      success: false,
      statusCode: 503,
      error: "Service Unavailable",
    });

    await trackDelivery({
      alertEventId: ALERT_EVENT_ID,
      channelType: "slack",
      channelName: "#alerts",
      deliverFn,
      attemptNumber: 4,
    });

    const updateCall = prismaMock.deliveryAttempt.update.mock.calls[0]![0];
    expect(updateCall.data.nextRetryAt).toBeNull();
  });

  it("sets nextRetryAt to null on success (no retry needed)", async () => {
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
      attemptNumber: 1,
    });

    const updateCall = prismaMock.deliveryAttempt.update.mock.calls[0]![0];
    expect(updateCall.data.nextRetryAt).toBeNull();
  });

  it("sets nextRetryAt when delivery throws an exception", async () => {
    mockCreateAttempt();
    mockUpdateAttempt();

    const deliverFn = vi
      .fn<() => Promise<DeliveryResult>>()
      .mockRejectedValue(new Error("Network error"));

    await trackDelivery({
      alertEventId: ALERT_EVENT_ID,
      channelType: "slack",
      channelName: "#alerts",
      deliverFn,
      attemptNumber: 1,
    });

    const updateCall = prismaMock.deliveryAttempt.update.mock.calls[0]![0];
    const nextRetryAt = updateCall.data.nextRetryAt as Date;
    expect(nextRetryAt).toBeInstanceOf(Date);
    expect(nextRetryAt.getTime()).toBe(
      new Date("2025-06-01T12:00:00Z").getTime() + 30_000,
    );
  });

  it("persists channelId when provided", async () => {
    mockCreateAttempt({ channelId: "ch-123" });
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
      channelId: "ch-123",
    });

    expect(prismaMock.deliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channelId: "ch-123",
      }),
    });
  });
});

// ─── getNextRetryAt ─────────────────────────────────────────────────────────

describe("getNextRetryAt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns now + 30s for attempt 1", () => {
    const result = getNextRetryAt(1);
    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBe(
      new Date("2025-06-01T12:00:00Z").getTime() + 30_000,
    );
  });

  it("returns now + 120s for attempt 2", () => {
    const result = getNextRetryAt(2);
    expect(result!.getTime()).toBe(
      new Date("2025-06-01T12:00:00Z").getTime() + 120_000,
    );
  });

  it("returns now + 600s for attempt 3", () => {
    const result = getNextRetryAt(3);
    expect(result!.getTime()).toBe(
      new Date("2025-06-01T12:00:00Z").getTime() + 600_000,
    );
  });

  it("returns null for attempt 4 (max retries exceeded)", () => {
    expect(getNextRetryAt(4)).toBeNull();
  });

  it("returns null for attempt 0 (invalid)", () => {
    expect(getNextRetryAt(0)).toBeNull();
  });

  it("returns null for negative attempts", () => {
    expect(getNextRetryAt(-1)).toBeNull();
  });
});

// ─── BACKOFF_DELAYS constant ────────────────────────────────────────────────

describe("BACKOFF_DELAYS", () => {
  it("has three entries: 30, 120, 600 seconds", () => {
    expect(BACKOFF_DELAYS).toEqual([30, 120, 600]);
  });
});

// ─── Convenience wrappers ───────────────────────────────────────────────────

describe("trackChannelDelivery", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("delegates to trackDelivery with the specified channelType, channelName, and channelId", async () => {
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
        channelId: "channel-1",
      }),
    });

    expect(deliverFn).toHaveBeenCalledOnce();
  });

  it("passes attemptNumber through when specified", async () => {
    mockCreateAttempt({ attemptNumber: 3 });
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
      3,
    );

    expect(prismaMock.deliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attemptNumber: 3,
      }),
    });
  });
});
