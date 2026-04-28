import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────
//
// vi.mock() factories run before module imports, so any locally-defined
// value referenced inside them must be hoisted with vi.hoisted().

const { fakeWebhookDriver } = vi.hoisted(() => ({
  fakeWebhookDriver: {
    deliver: vi.fn(),
    test: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

// Replace the real webhook driver with a spy so we can assert what config
// the dispatcher hands it. The driver itself is tested in webhook.test.ts.
vi.mock("@/server/services/channels/webhook", () => ({
  webhookDriver: fakeWebhookDriver,
}));

// Avoid creating real DeliveryAttempt rows when alertEventId is passed.
vi.mock("@/server/services/delivery-tracking", () => ({
  trackChannelDelivery: vi.fn(
    async (
      _alertEventId: string,
      _channelId: string,
      _channelType: string,
      _channelName: string,
      deliverFn: () => Promise<{ success: boolean; error?: string }>,
    ) => deliverFn(),
  ),
}));

import { prisma } from "@/lib/prisma";
import { deliverToChannels } from "@/server/services/channels";
import type { ChannelPayload } from "@/server/services/channels/types";
import { encrypt, ENCRYPTION_DOMAINS } from "@/server/services/crypto";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

function makePayload(): ChannelPayload {
  return {
    alertId: "alert-1",
    status: "firing",
    ruleName: "CPU High",
    severity: "warning",
    environment: "Production",
    metric: "cpu_usage",
    value: 92.5,
    threshold: 80,
    message: "CPU usage is 92.50 (threshold: > 80)",
    timestamp: "2026-03-31T12:00:00.000Z",
    dashboardUrl: "https://vf.example.com/alerts",
  };
}

describe("deliverToChannels — secret decryption at driver boundary", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    fakeWebhookDriver.deliver.mockReset();
    fakeWebhookDriver.test.mockReset();
    delete process.env.NEXT_PUBLIC_VF_DEMO_MODE;
  });

  it("decrypts hmacSecret before passing config to webhook driver (broadcast path)", async () => {
    fakeWebhookDriver.deliver.mockResolvedValue({
      channelId: "ch1",
      success: true,
    });

    const encryptedSecret = encrypt("raw-secret", ENCRYPTION_DOMAINS.SECRETS);
    expect(encryptedSecret.startsWith("v2:")).toBe(true);

    prismaMock.notificationChannel.findMany.mockResolvedValue([
      {
        id: "ch1",
        name: "Webhook 1",
        type: "webhook",
        config: {
          url: "https://hooks.example.com/x",
          hmacSecret: encryptedSecret,
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: select returns partial rows
    ] as any);

    await deliverToChannels("env-1", null, makePayload());

    expect(fakeWebhookDriver.deliver).toHaveBeenCalledTimes(1);
    expect(fakeWebhookDriver.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://hooks.example.com/x",
        hmacSecret: "raw-secret",
      }),
      expect.objectContaining({ alertId: "alert-1" }),
    );
  });

  it("decrypts hmacSecret on the tracked-delivery path (alertEventId provided)", async () => {
    fakeWebhookDriver.deliver.mockResolvedValue({
      channelId: "ch1",
      success: true,
    });

    const encryptedSecret = encrypt("tracked-secret", ENCRYPTION_DOMAINS.SECRETS);

    prismaMock.notificationChannel.findMany.mockResolvedValue([
      {
        id: "ch1",
        name: "Webhook 1",
        type: "webhook",
        config: {
          url: "https://hooks.example.com/x",
          hmacSecret: encryptedSecret,
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: select returns partial rows
    ] as any);

    await deliverToChannels("env-1", null, makePayload(), "alert-event-1");

    expect(fakeWebhookDriver.deliver).toHaveBeenCalledTimes(1);
    const [configArg] = fakeWebhookDriver.deliver.mock.calls[0];
    expect(configArg).toMatchObject({
      url: "https://hooks.example.com/x",
      hmacSecret: "tracked-secret",
    });
  });
});
