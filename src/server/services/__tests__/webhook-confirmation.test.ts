/**
 * Webhook destination one-time confirmation lifecycle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import { createHash } from "node:crypto";

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

import { prisma } from "@/lib/prisma";
import {
  WEBHOOK_CONFIRMATION_TTL_MS,
  consumeWebhookConfirmation,
  gcExpiredWebhookConfirmations,
  mintWebhookConfirmation,
} from "@/server/services/webhook-confirmation";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

function hex(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

beforeEach(() => {
  mockReset(prismaMock);
  prismaMock.$transaction.mockImplementation(
    async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mintWebhookConfirmation", () => {
  it("returns plaintext token and stores only the hash with 48h TTL", async () => {
    prismaMock.webhookConfirmation.create.mockResolvedValue({} as never);

    const r = await mintWebhookConfirmation({
      webhookEndpointId: "wh-1",
      organizationId: "org-1",
      requestedById: "user-1",
    });

    expect(r.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const ttl = r.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(WEBHOOK_CONFIRMATION_TTL_MS - 2000);
    expect(ttl).toBeLessThanOrEqual(WEBHOOK_CONFIRMATION_TTL_MS);

    const data = prismaMock.webhookConfirmation.create.mock.calls[0]?.[0]?.data;
    expect(data?.tokenHash).toBe(hex(r.token));
    // Plaintext token must not be in the persisted row.
    expect(JSON.stringify(data)).not.toContain(r.token);
  });
});

describe("consumeWebhookConfirmation", () => {
  it("happy path: redeems, sets confirmedAt on the endpoint, returns ok", async () => {
    const plaintext = "test-confirm";
    prismaMock.webhookConfirmation.findUnique.mockResolvedValue({
      id: "wc-1",
      webhookEndpointId: "wh-1",
      organizationId: "org-1",
      tokenHash: hex(plaintext),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    } as never);
    prismaMock.webhookConfirmation.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.webhookEndpoint.update.mockResolvedValue({} as never);

    const r = await consumeWebhookConfirmation({ token: plaintext });
    expect(r).toEqual({
      ok: true,
      webhookEndpointId: "wh-1",
      organizationId: "org-1",
    });
    expect(prismaMock.webhookEndpoint.update).toHaveBeenCalledWith({
      where: { id: "wh-1" },
      data: expect.objectContaining({ confirmedAt: expect.any(Date) }),
    });
  });

  it("rejects expired tokens", async () => {
    const plaintext = "expired-token";
    prismaMock.webhookConfirmation.findUnique.mockResolvedValue({
      id: "wc-1",
      webhookEndpointId: "wh-1",
      organizationId: "org-1",
      tokenHash: hex(plaintext),
      expiresAt: new Date(Date.now() - 1_000),
      consumedAt: null,
    } as never);

    await expect(
      consumeWebhookConfirmation({ token: plaintext }),
    ).resolves.toEqual({ ok: false, reason: "expired" });
    expect(prismaMock.webhookEndpoint.update).not.toHaveBeenCalled();
  });

  it("rejects already-consumed tokens (replay)", async () => {
    const plaintext = "used-token";
    prismaMock.webhookConfirmation.findUnique.mockResolvedValue({
      id: "wc-1",
      webhookEndpointId: "wh-1",
      organizationId: "org-1",
      tokenHash: hex(plaintext),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(),
    } as never);

    await expect(
      consumeWebhookConfirmation({ token: plaintext }),
    ).resolves.toEqual({ ok: false, reason: "already_used" });
  });

  it("rejects unknown tokens", async () => {
    prismaMock.webhookConfirmation.findUnique.mockResolvedValue(null);
    await expect(
      consumeWebhookConfirmation({ token: "ghost" }),
    ).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("loses-the-race path: updateMany returns 0 -> already_used", async () => {
    const plaintext = "race-token";
    prismaMock.webhookConfirmation.findUnique.mockResolvedValue({
      id: "wc-1",
      webhookEndpointId: "wh-1",
      organizationId: "org-1",
      tokenHash: hex(plaintext),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    } as never);
    prismaMock.webhookConfirmation.updateMany.mockResolvedValue({ count: 0 } as never);

    await expect(
      consumeWebhookConfirmation({ token: plaintext }),
    ).resolves.toEqual({ ok: false, reason: "already_used" });
    expect(prismaMock.webhookEndpoint.update).not.toHaveBeenCalled();
  });
});

describe("gcExpiredWebhookConfirmations", () => {
  it("deletes expired-unconsumed and consumed-older-than-30d rows", async () => {
    prismaMock.webhookConfirmation.deleteMany.mockResolvedValue({ count: 3 } as never);
    const now = new Date("2026-05-16T12:00:00.000Z");
    await expect(gcExpiredWebhookConfirmations(() => now)).resolves.toBe(3);
    const call = prismaMock.webhookConfirmation.deleteMany.mock.calls[0]?.[0];
    expect(call?.where).toEqual({
      OR: [
        { expiresAt: { lt: now }, consumedAt: null },
        {
          consumedAt: {
            lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
          },
        },
      ],
    });
  });
});
