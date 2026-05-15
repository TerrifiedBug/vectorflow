-- Phase 5f — Stripe webhook idempotency ledger.
--
-- See plan addendum §6: Stripe redelivers webhooks on 5xx responses,
-- so the Cloud handler must guarantee once-only processing. The
-- handler attempts INSERT INTO "StripeWebhookEvent" (id, type) VALUES
-- ($1, $2) ON CONFLICT (id) DO NOTHING; if 0 rows are affected, the
-- delivery is a duplicate and is acknowledged with HTTP 200 without
-- side effects.
--
-- OSS deployments never insert into this table (no Stripe integration
-- in OSS), so the migration is a pure additive no-op for self-hosted.
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
