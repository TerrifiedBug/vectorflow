/**
 * Stripe webhook idempotency ledger helper.
 *
 * Stripe redelivers webhook events on any 5xx response. The Cloud
 * handler (in the closed `cloud/` workspace) calls
 * `recordStripeEventOrSkip(event.id, event.type)` at the top of each
 * delivery. If `processed === false` the event has been seen before;
 * the handler returns HTTP 200 immediately with no side effects.
 *
 * Implementation: rely on the PK uniqueness of `StripeWebhookEvent.id`
 * to surface duplicates as Prisma's P2002 error, which we translate
 * into `processed: false`. Any other error propagates so the caller
 * returns 5xx and Stripe retries.
 */

import { prisma } from "@/lib/prisma";

const P2002_UNIQUE_CONSTRAINT = "P2002";

export interface RecordStripeEventResult {
  /** True when this delivery is the first time the event was committed. */
  processed: boolean;
}

export async function recordStripeEventOrSkip(
  eventId: string,
  type: string,
): Promise<RecordStripeEventResult> {
  try {
    await prisma.stripeWebhookEvent.create({
      data: { id: eventId, type },
    });
    return { processed: true };
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === P2002_UNIQUE_CONSTRAINT) {
      // Duplicate delivery — Stripe retried; ack with no-op.
      return { processed: false };
    }
    throw err;
  }
}
