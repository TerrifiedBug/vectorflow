-- Phase 4 hotfix — AuditChainTail pointer table.
--
-- writeAuditLog used to derive the previous chain hash via:
--   SELECT hash FROM "AuditLog"
--    WHERE "organizationId" = $1 AND hash IS NOT NULL
--    ORDER BY "createdAt" DESC, id DESC LIMIT 1;
--
-- That tiebreak on `id DESC` is correct within a single process (audit
-- ids use ulid.monotonicFactory()) but NOT across pods/workers. Two
-- writers hitting the same org in the same millisecond from different
-- processes can produce IDs whose lex order does not match insertion
-- order, picking the wrong tail and forking the chain.
--
-- The advisory transaction lock already serialises writes per-org, so we
-- can maintain a single-row tail pointer per org INSIDE the same locked
-- transaction. The pointer always reflects the most-recent committed
-- chained row regardless of timestamps or ID ordering.
--
-- Rollback:
--   DROP TABLE "AuditChainTail";

CREATE TABLE IF NOT EXISTS "AuditChainTail" (
    "organizationId" TEXT PRIMARY KEY,
    "lastHash"       TEXT NOT NULL,
    "lastWriteAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL
);
