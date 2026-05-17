-- Webhook idempotency ledger: original single-source table for inbound
-- webhooks that redeliver on 5xx responses. The handler attempts
-- INSERT INTO "StripeWebhookEvent" (id, type) VALUES ($1, $2)
-- ON CONFLICT (id) DO NOTHING; if 0 rows are affected, the delivery is
-- a duplicate and is acknowledged with HTTP 200 without side effects.
--
-- This table was renamed to `IdempotentInboundWebhookEvent` in a
-- subsequent migration (`20260517000001_rename_..._to_idempotent_inbound`)
-- so the schema is provider-agnostic. The original name is preserved
-- here for migration history only — single-tenant deployments that do
-- not wire a webhook source insert nothing into the table.
--
-- Rollback: DROP TABLE "StripeWebhookEvent";

CREATE TABLE IF NOT EXISTS "StripeWebhookEvent" (
    "id"          TEXT PRIMARY KEY,
    "type"        TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "StripeWebhookEvent_processedAt_idx"
    ON "StripeWebhookEvent" ("processedAt");
CREATE INDEX IF NOT EXISTS "StripeWebhookEvent_type_idx"
    ON "StripeWebhookEvent" ("type");
