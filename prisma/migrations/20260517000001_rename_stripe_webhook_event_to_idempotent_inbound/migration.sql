-- §15a R1 remediation — rename Stripe-branded idempotency ledger to a
-- generic inbound-webhook ledger so the AGPL OSS repo doesn't ship a
-- Stripe-named primitive. The pattern is genuinely reusable: any
-- inbound webhook source that supports redelivery on 5xx (git providers,
-- PagerDuty, custom integrations) can call recordInboundWebhookOrSkip().
--
-- Cloud-side Stripe handler maps:
--   event.id  -> id
--   event.type -> type
--   source = "stripe"
--
-- The rename is reversible: ALTER TABLE RENAME preserves data; the
-- existing StripeWebhookEvent rows (if any) move to the new table name.
--
-- Rollback:
--   ALTER TABLE "IdempotentInboundWebhookEvent" DROP COLUMN "source";
--   ALTER TABLE "IdempotentInboundWebhookEvent" RENAME TO "StripeWebhookEvent";

ALTER TABLE "StripeWebhookEvent" RENAME TO "IdempotentInboundWebhookEvent";

ALTER INDEX "StripeWebhookEvent_pkey"
    RENAME TO "IdempotentInboundWebhookEvent_pkey";
ALTER INDEX "StripeWebhookEvent_processedAt_idx"
    RENAME TO "IdempotentInboundWebhookEvent_processedAt_idx";
ALTER INDEX "StripeWebhookEvent_type_idx"
    RENAME TO "IdempotentInboundWebhookEvent_type_idx";

-- Add source column with a backfill default so any existing rows (Cloud
-- preview deployments only — OSS never wrote to this table) are
-- attributed to Stripe. The default is dropped in a follow-up migration
-- once Cloud writes set source explicitly; for now it keeps inserts
-- backward-compatible with the original recordStripeEventOrSkip
-- signature during the deprecation window.
ALTER TABLE "IdempotentInboundWebhookEvent"
    ADD COLUMN "source" TEXT NOT NULL DEFAULT 'stripe';

CREATE INDEX IF NOT EXISTS "IdempotentInboundWebhookEvent_source_idx"
    ON "IdempotentInboundWebhookEvent" ("source");
CREATE INDEX IF NOT EXISTS "IdempotentInboundWebhookEvent_source_processedAt_idx"
    ON "IdempotentInboundWebhookEvent" ("source", "processedAt");
