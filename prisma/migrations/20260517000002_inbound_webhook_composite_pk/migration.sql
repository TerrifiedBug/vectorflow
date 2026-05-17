-- Change primary key from (id) to (source, id) to enforce proper per-source
-- idempotency and prevent cross-source id-space collisions.
--
-- Problem: with id as sole PK, inserting a second event with a different
-- source but the same id string is incorrectly treated as a duplicate
-- delivery and silently skipped (P2002 unique violation on the PK).
--
-- Fix: composite PK (source, id) ensures uniqueness is scoped to each
-- source's id-space, matching the intended semantics of the table.
--
-- Safety:
--   - No FK references to this table (idempotency log only).
--   - All existing rows have source='stripe' (set by the rename migration's
--     DEFAULT). The id column was already unique within stripe, so no PK
--     violations will occur.
--
-- Backfill: none needed. No data is modified.
--
-- Index impact: the existing (source, processedAt) and (source) indexes
-- remain valid. The renamed PK index now covers (source, id).
--
-- TimescaleDB: not a hypertable. Plain table, composite PK is safe.
--
-- Rollback:
--   ALTER TABLE "IdempotentInboundWebhookEvent" DROP CONSTRAINT "IdempotentInboundWebhookEvent_pkey";
--   ALTER TABLE "IdempotentInboundWebhookEvent" ADD CONSTRAINT "IdempotentInboundWebhookEvent_pkey" PRIMARY KEY ("id");

ALTER TABLE "IdempotentInboundWebhookEvent"
  DROP CONSTRAINT "IdempotentInboundWebhookEvent_pkey";

ALTER TABLE "IdempotentInboundWebhookEvent"
  ADD CONSTRAINT "IdempotentInboundWebhookEvent_pkey"
  PRIMARY KEY ("source", "id");
