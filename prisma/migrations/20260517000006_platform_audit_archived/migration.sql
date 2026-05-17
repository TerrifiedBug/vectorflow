-- PlatformAuditLog: add optional archive columns so an external archiver
-- sidecar can stamp rows it has copied to long-term storage. Default
-- deployments leave both columns NULL and run no archiver; the cost is
-- two NULL columns per row.

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

-- Replace the blanket DO INSTEAD NOTHING rule (from migration 20260517000003)
-- with a trigger that ALLOWS archiver updates (archivedAt + archivedObjectKey)
-- while still blocking modifications to chain-critical fields.
--
-- The old rule silently drops ALL UPDATEs, which means the archiver can never
-- stamp archivedAt. The trigger approach lets archiver-only updates through and
-- raises an error on any attempt to modify chain-critical fields.
DROP RULE IF EXISTS "PlatformAuditLog_no_update" ON "PlatformAuditLog";

CREATE OR REPLACE FUNCTION "PlatformAuditLog_guard_update"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only allow updates that exclusively touch archivedAt / archivedObjectKey.
  -- Any attempt to modify chain-critical columns raises an exception so the
  -- append-only invariant is preserved at the row level (not just by rules).
  IF (NEW.id             IS DISTINCT FROM OLD.id             OR
      NEW."stampId"      IS DISTINCT FROM OLD."stampId"      OR
      NEW."operatorId"   IS DISTINCT FROM OLD."operatorId"   OR
      NEW."operatorRole" IS DISTINCT FROM OLD."operatorRole" OR
      NEW.action         IS DISTINCT FROM OLD.action         OR
      NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR
      NEW.reason         IS DISTINCT FROM OLD.reason         OR
      NEW."entityType"   IS DISTINCT FROM OLD."entityType"   OR
      NEW."entityId"     IS DISTINCT FROM OLD."entityId"     OR
      NEW.metadata       IS DISTINCT FROM OLD.metadata       OR
      NEW."ipAddress"    IS DISTINCT FROM OLD."ipAddress"    OR
      NEW."createdAt"    IS DISTINCT FROM OLD."createdAt"    OR
      NEW."prevHash"     IS DISTINCT FROM OLD."prevHash"     OR
      NEW.hash           IS DISTINCT FROM OLD.hash)
  THEN
    RAISE EXCEPTION 'PlatformAuditLog: modification of chain-critical fields is prohibited (append-only enforcement)';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PlatformAuditLog_guard_update_trg"
  BEFORE UPDATE ON "PlatformAuditLog"
  FOR EACH ROW EXECUTE FUNCTION "PlatformAuditLog_guard_update"();

COMMENT ON TRIGGER "PlatformAuditLog_guard_update_trg" ON "PlatformAuditLog" IS
  'Allows archiver-only UPDATEs (archivedAt / archivedObjectKey); blocks chain-critical field mutations.';
