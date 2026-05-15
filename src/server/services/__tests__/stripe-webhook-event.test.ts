import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stripeWebhookEvent: {
      create: mocks.create,
      findUnique: mocks.findUnique,
    },
  },
}));

import { recordStripeEventOrSkip } from "../stripe-webhook-event";

describe("recordStripeEventOrSkip", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.findUnique.mockReset();
  });

  it("returns processed:true on first delivery (INSERT succeeds)", async () => {
    mocks.create.mockResolvedValue({
      id: "evt_1",
      type: "customer.subscription.updated",
      processedAt: new Date(),
    });
    const r = await recordStripeEventOrSkip("evt_1", "customer.subscription.updated");
    expect(r.processed).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith({
      data: { id: "evt_1", type: "customer.subscription.updated" },
    });
  });

  it("returns processed:false on duplicate delivery (P2002 unique violation)", async () => {
    const err = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });
    mocks.create.mockRejectedValue(err);
    const r = await recordStripeEventOrSkip("evt_dup", "invoice.paid");
    expect(r.processed).toBe(false);
  });

  it("propagates unexpected errors instead of silently dropping the event", async () => {
    const err = new Error("connection refused");
    mocks.create.mockRejectedValue(err);
    await expect(
      recordStripeEventOrSkip("evt_x", "customer.created"),
    ).rejects.toThrow(/connection refused/);
  });
});
