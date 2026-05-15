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
-- ─── Seed step ────────────────────────────────────────────────────────────
--
-- For any org that already has hashed AuditLog rows (e.g. a staged rollout
-- has been writing under the previous tail-via-AuditLog design), pick the
-- chain tip and seed it. Without this seed, the first post-migration write
-- for those orgs would fall back to genesis and permanently fork their
-- chain.
--
-- Critically: we do NOT order by (createdAt, id) — that's the same
-- ordering Codex correctly flagged as cross-process-unsafe. Instead we
-- pick by chain-link topology: the tail is the row whose `hash` is not
-- referenced as anyone's `prevHash`. That's a property of the chain
-- itself, independent of insertion-time ordering, so it's correct under
-- any historical contention pattern.
--
-- Rollback:
--   DROP TABLE "AuditChainTail";

CREATE TABLE IF NOT EXISTS "AuditChainTail" (
    "organizationId" TEXT PRIMARY KEY,
    "lastHash"       TEXT NOT NULL,
    "lastWriteAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL
);

INSERT INTO "AuditChainTail" ("organizationId", "lastHash", "lastWriteAt", "updatedAt")
SELECT a."organizationId",
       a."hash",
       a."createdAt",
       CURRENT_TIMESTAMP
  FROM "AuditLog" a
 WHERE a."hash" IS NOT NULL
   AND NOT EXISTS (
       SELECT 1
         FROM "AuditLog" b
        WHERE b."organizationId" = a."organizationId"
          AND b."prevHash"       = a."hash"
   )
ON CONFLICT ("organizationId") DO NOTHING;
