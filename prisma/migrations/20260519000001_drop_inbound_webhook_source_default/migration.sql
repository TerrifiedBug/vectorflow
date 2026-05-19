-- Drop the back-compat default on IdempotentInboundWebhookEvent.source.
--
-- The schema previously kept `source` defaulted for upgrade compatibility
-- with the prior single-source table, when only one provider wrote rows
-- and migrating callers might not yet pass the field. All current writers
-- pass `source` explicitly via the recordInboundWebhookOrSkip helper, so
-- the default has no remaining consumers and only carries provider-
-- specific semantic baggage in the schema.
--
-- Existing rows are untouched: the previous default has already been
-- applied at insert time, so DROP DEFAULT only affects future inserts —
-- which must now pass `source` explicitly, matching the docstring
-- contract on the column.
--
-- Rollback:
--   ALTER TABLE "IdempotentInboundWebhookEvent"
--     ALTER COLUMN "source" SET DEFAULT 'stripe';

ALTER TABLE "IdempotentInboundWebhookEvent"
  ALTER COLUMN "source" DROP DEFAULT;
