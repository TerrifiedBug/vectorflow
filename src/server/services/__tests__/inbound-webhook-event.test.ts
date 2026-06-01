import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => { const __pm = {
  idempotentInboundWebhookEvent: {
    create: mocks.create,
    findUnique: mocks.findUnique,
  },
}; return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

import {
  recordInboundWebhookOrSkip,
} from "../inbound-webhook-event";

describe("recordInboundWebhookOrSkip", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.findUnique.mockReset();
  });

  it("returns processed:true on first delivery (INSERT succeeds)", async () => {
    mocks.create.mockResolvedValue({
      id: "evt_1",
      source: "stripe",
      type: "customer.subscription.updated",
      processedAt: new Date(),
    });
    const r = await recordInboundWebhookOrSkip({
      source: "stripe",
      id: "evt_1",
      type: "customer.subscription.updated",
    });
    expect(r.processed).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        id: "evt_1",
        source: "stripe",
        type: "customer.subscription.updated",
      },
    });
  });

  it("returns processed:false on duplicate delivery (P2002 unique violation)", async () => {
    const err = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });
    mocks.create.mockRejectedValue(err);
    const r = await recordInboundWebhookOrSkip({
      source: "stripe",
      id: "evt_dup",
      type: "invoice.paid",
    });
    expect(r.processed).toBe(false);
  });

  it("propagates unexpected errors so upstream retries", async () => {
    const err = new Error("connection refused");
    mocks.create.mockRejectedValue(err);
    await expect(
      recordInboundWebhookOrSkip({
        source: "stripe",
        id: "evt_x",
        type: "customer.created",
      }),
    ).rejects.toThrow(/connection refused/);
  });

  it("accepts non-stripe sources without special-casing", async () => {
    mocks.create.mockResolvedValue({
      id: "gh-uuid-1",
      source: "github",
      type: "push",
      processedAt: new Date(),
    });
    const r = await recordInboundWebhookOrSkip({
      source: "github",
      id: "gh-uuid-1",
      type: "push",
    });
    expect(r.processed).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith({
      data: { id: "gh-uuid-1", source: "github", type: "push" },
    });
  });
});
