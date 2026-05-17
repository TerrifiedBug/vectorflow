/**
 * @deprecated Compatibility shim — import from
 *   `@/server/services/inbound-webhook-event` instead.
 *
 * This file existed as `stripe-webhook-event.ts` before the 2026-05-17
 * rename (plan §15a R1). It is kept here for one deprecation cycle so
 * downstream handlers (vectorflow-cloud Stripe webhook) can migrate at
 * their own pace without a flag-day rename.
 *
 * Scheduled for removal once §16b cloud-7 Stripe handler lands.
 */
export {
  recordInboundWebhookOrSkip,
  recordStripeEventOrSkip,
} from "./inbound-webhook-event";
export type {
  RecordInboundWebhookArgs,
  RecordInboundWebhookResult,
} from "./inbound-webhook-event";
/** @deprecated Use `RecordInboundWebhookResult`. */
export type { RecordInboundWebhookResult as RecordStripeEventResult } from "./inbound-webhook-event";
