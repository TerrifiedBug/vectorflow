-- Phase 5z: explicit per-org opt-in for non-allowlisted AI provider baseUrls.
--
-- Backfill: every existing OrganizationSettings row inherits the conservative
-- `false` default. OSS users targeting a custom Ollama / Azure / etc.
-- endpoint MUST flip this flag (via the admin UI) before AI calls succeed
-- in Cloud-strict mode. Self-hosted deployments are unaffected because
-- `validateOutboundUrl` is gated by `VF_CLOUD_STRICT_OUTBOUND`.
--
-- Index: none — this is a per-row boolean, not a query target.
--
-- TimescaleDB: N/A (table is configuration, not time-series).
--
-- Rollback: drop the column. No data loss; the column carries no
-- behaviour-critical information when the flag stays at its default.

ALTER TABLE "OrganizationSettings"
  ADD COLUMN "aiBaseUrlOptIn" BOOLEAN NOT NULL DEFAULT false;
