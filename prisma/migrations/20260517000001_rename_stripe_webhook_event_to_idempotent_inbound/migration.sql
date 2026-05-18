-- Rename the inbound webhook idempotency ledger from a vendor-specific
-- name to a generic one. The pattern is reusable for any inbound webhook
-- source that supports redelivery on 5xx (git providers, PagerDuty,
-- custom integrations) — callers map `event.id -> id`, `event.type -> type`,
-- and set `source` to a stable identifier for the upstream system.
--
-- The rename is reversible: ALTER TABLE RENAME preserves data; any rows
-- written under the previous table name move to the new table name.
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

-- Add `source` with a backfill default so any pre-existing rows from the
-- previous (single-source) table get a non-NULL value. The default is
-- harmless going forward — new callers always set `source` explicitly —
-- and can be dropped in a follow-up migration once no caller relies on it.
ALTER TABLE "IdempotentInboundWebhookEvent"
    ADD COLUMN "source" TEXT NOT NULL DEFAULT 'stripe';

CREATE INDEX IF NOT EXISTS "IdempotentInboundWebhookEvent_source_idx"
    ON "IdempotentInboundWebhookEvent" ("source");
CREATE INDEX IF NOT EXISTS "IdempotentInboundWebhookEvent_source_processedAt_idx"
    ON "IdempotentInboundWebhookEvent" ("source", "processedAt");
