-- PlatformAuditLog: add archive columns for the Cloud-side audit
-- archiver sidecar (§16b cloud-11). OSS / self-hosted installs leave
-- both columns NULL and the archiver disabled; the cost is two NULL
-- columns per row.

ALTER TABLE "PlatformAuditLog"
  ADD COLUMN "archivedAt"        TIMESTAMP(3),
  ADD COLUMN "archivedObjectKey" TEXT;

-- Partial-style index for the archiver's poll query
-- `WHERE archivedAt IS NULL ORDER BY createdAt ASC`. Postgres uses the
-- composite index for the order-by + treats `archivedAt IS NULL` as a
-- selective predicate. In steady state the unarchived backlog is
-- small, so the index footprint stays bounded.
-- Partial index: only indexes unarchived rows, keeping footprint bounded.
CREATE INDEX "PlatformAuditLog_archivedAt_createdAt_idx"
  ON "PlatformAuditLog"("createdAt")
  WHERE "archivedAt" IS NULL;
