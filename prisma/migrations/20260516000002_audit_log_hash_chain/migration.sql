-- Phase 4 — AuditLog tamper-evidence hash chain.
--
-- Adds `prevHash` and `hash` columns. Default '' keeps the migration safe on
-- existing rows; a one-shot backfill (scripts/backfill-audit-chain.ts) walks
-- the table in (organizationId, createdAt) order, computing real hashes for
-- existing rows so future inserts chain off them.
--
-- Hash format:
--   hash = sha256(prevHash || canonical_json(row))
--   prevHash[0] = sha256("vf:audit-genesis:" || organizationId)
--   prevHash[n] = hash[n-1]
--
-- Index on (organizationId, createdAt) supports the tail-lookup query the
-- insert path uses to fetch the current chain tip per org.

ALTER TABLE "AuditLog"
    ADD COLUMN IF NOT EXISTS "prevHash" TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "hash"     TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_createdAt_chain_idx"
    ON "AuditLog" ("organizationId", "createdAt" DESC, "id" DESC);
