-- Phase 4 — AuditLog tamper-evidence hash chain.
--
-- Adds nullable `prevHash` and `hash` columns. NULL on existing rows so
-- backwards compatibility holds without forcing a value at migration time;
-- a one-shot backfill (scripts/backfill-audit-chain.ts) walks the table
-- in (organizationId, createdAt) order, computing real hashes for existing
-- rows so future inserts chain off them.
--
-- We deliberately do NOT use `DEFAULT ''` here. An empty-string default
-- is a truthy-but-meaningless tail value that would cause new inserts to
-- chain off `''` rather than the org genesis. NULL is the only correct
-- "no chain yet" sentinel.
--
-- Hash format:
--   hash = sha256(prevHash || canonical_json(row))
--   prevHash[0] = sha256("vf:audit-genesis:" || organizationId)
--   prevHash[n] = hash[n-1]
--
-- Index on (organizationId, createdAt) supports the tail-lookup query the
-- insert path uses to fetch the current chain tip per org. Partial-index
-- predicate `WHERE hash IS NOT NULL` keeps un-backfilled rows out of the
-- tail-lookup hot path so writeAuditLog always picks a real chain tip.

ALTER TABLE "AuditLog"
    ADD COLUMN IF NOT EXISTS "prevHash" TEXT,
    ADD COLUMN IF NOT EXISTS "hash"     TEXT;

CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_createdAt_chain_idx"
    ON "AuditLog" ("organizationId", "createdAt" DESC, "id" DESC)
    WHERE "hash" IS NOT NULL;
