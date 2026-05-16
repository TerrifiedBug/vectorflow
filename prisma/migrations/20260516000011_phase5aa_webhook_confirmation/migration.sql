-- Phase 5aa: webhook destination one-time confirmation + DNS rebinding
-- mitigation + redirect cap.
--
-- This migration covers ONLY the confirmation half. The DNS rebinding and
-- redirect-cap logic live in the service layer (`outbound-webhook.ts`) and
-- need no schema changes.
--
-- Backfill: every existing `WebhookEndpoint` row gets
-- `confirmedAt = CURRENT_TIMESTAMP`. Rationale: forcing operators to
-- re-confirm every previously-working webhook on a routine deploy would
-- be operationally hostile. New endpoints (post-migration) start NULL and
-- MUST be confirmed before they can deliver.
--
-- Index strategy:
--   - WebhookConfirmation.tokenHash UNIQUE — replay-after-consume fails
--     with a constraint violation rather than an opaque downstream error.
--   - WebhookConfirmation.webhookEndpointId indexed — lookup by endpoint
--     for the periodic GC sweep.
--   - WebhookConfirmation.(organizationId, expiresAt) composite — supports
--     "delete expired confirmations for this org" queries.
--
-- TimescaleDB: not a hypertable.
--
-- Rollback:
--   1. DROP TABLE "WebhookConfirmation";
--   2. ALTER TABLE "WebhookEndpoint" DROP COLUMN "confirmedAt";
-- Both are reversible without data loss \u2014 deliveries continue to operate
-- exactly as they did pre-migration.

ALTER TABLE "WebhookEndpoint"
  ADD COLUMN "confirmedAt" TIMESTAMP(3);

-- Backfill: existing endpoints are grandfathered as already-confirmed.
UPDATE "WebhookEndpoint" SET "confirmedAt" = NOW();

CREATE TABLE "WebhookConfirmation" (
  "id"                TEXT NOT NULL,
  "organizationId"    TEXT NOT NULL,
  "webhookEndpointId" TEXT NOT NULL,
  "tokenHash"         TEXT NOT NULL,
  "expiresAt"         TIMESTAMP(3) NOT NULL,
  "consumedAt"        TIMESTAMP(3),
  "requestedById"     TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebhookConfirmation_tokenHash_key"
  ON "WebhookConfirmation"("tokenHash");
CREATE INDEX "WebhookConfirmation_webhookEndpointId_idx"
  ON "WebhookConfirmation"("webhookEndpointId");
CREATE INDEX "WebhookConfirmation_organizationId_expiresAt_idx"
  ON "WebhookConfirmation"("organizationId", "expiresAt");

ALTER TABLE "WebhookConfirmation"
  ADD CONSTRAINT "WebhookConfirmation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookConfirmation"
  ADD CONSTRAINT "WebhookConfirmation_webhookEndpointId_fkey"
  FOREIGN KEY ("webhookEndpointId") REFERENCES "WebhookEndpoint"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
