/**
 * Idempotency helper for inbound webhooks that redeliver on 5xx.
 *
 * Generic primitive — any webhook source (Stripe Billing, git providers,
 * PagerDuty, custom integrations) where the upstream retries on a 5xx
 * response uses this to guarantee once-only processing.
 *
 * Usage from a webhook handler:
 *
 *   const { processed } = await recordInboundWebhookOrSkip({
 *     source: "stripe",
 *     id: stripeEvent.id,
 *     type: stripeEvent.type,
 *   });
 *   if (!processed) return new Response(null, { status: 200 });
 *
 * Implementation: rely on the composite PK uniqueness of
 * `IdempotentInboundWebhookEvent(source, id)` to surface duplicate
 * deliveries as Prisma's P2002 error, which we translate into
 * `processed: false`. Any other error propagates so the caller returns
 * 5xx and the upstream retries. The composite key ensures that the same
 * event id arriving from two different sources is treated as two distinct
 * events (correct behaviour) rather than a duplicate (silent data loss).
 */
import { prisma } from "@/lib/prisma";

const P2002_UNIQUE_CONSTRAINT = "P2002";

export interface RecordInboundWebhookArgs {
  /**
   * Lowercase identifier of the webhook source ("stripe", "github",
   * "gitlab", "pagerduty", ...). Stable per source; do not vary.
   */
  source: string;
  /** Provider-issued event id (PK). */
  id: string;
  /** Provider-issued event type (informational; indexed for diagnostics). */
  type: string;
}

export interface RecordInboundWebhookResult {
  /** True when this delivery is the first time the event was committed. */
  processed: boolean;
}

export async function recordInboundWebhookOrSkip(
  args: RecordInboundWebhookArgs,
): Promise<RecordInboundWebhookResult> {
  try {
    await prisma.idempotentInboundWebhookEvent.create({
      data: { id: args.id, source: args.source, type: args.type },
    });
    return { processed: true };
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === P2002_UNIQUE_CONSTRAINT) {
      // Duplicate delivery — upstream retried; ack with no-op.
      return { processed: false };
    }
    throw err;
  }
}

