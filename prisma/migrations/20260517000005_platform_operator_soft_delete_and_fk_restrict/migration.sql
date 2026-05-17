-- Platform operator soft-delete + audit-log FK hardening.
--
-- Two changes, related:
--
-- 1) Add `PlatformOperator.deletedAt` for soft-deletion. Operators with
--    audit-log entries CAN'T be hard-deleted (see (2) below); they must
--    be soft-deleted so the audit trail's "who acted" pointer survives.
--
-- 2) Replace the existing `ON DELETE SET NULL` FK on
--    `PlatformAuditLog.operatorId` with `ON DELETE RESTRICT`. The
--    original SET NULL was unreachable in practice because the
--    append-only `INSTEAD OF UPDATE DO NOTHING` rule on
--    `PlatformAuditLog` silently blocks the SET NULL update path,
--    leaving the foreign key cleanup half-done. RESTRICT is the
--    semantically correct mode: removing an operator who has audit
--    entries would erase the "who acted" pointer and defeat the
--    table's purpose. Codex P1 finding on PR #346.
--
-- Forward-fix: idempotent across re-runs. If the original FK is
-- already SET NULL, drop and recreate as RESTRICT. If
-- `deletedAt` is already present, the ADD COLUMN is a no-op.

DO $$
BEGIN
  -- (1) Add deletedAt to PlatformOperator (nullable, default NULL).
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name  = 'PlatformOperator'
       AND column_name = 'deletedAt'
  ) THEN
    ALTER TABLE "PlatformOperator"
      ADD COLUMN "deletedAt" TIMESTAMP(3);
    RAISE NOTICE 'platform-operator-soft-delete: added deletedAt column';
  ELSE
    RAISE NOTICE 'platform-operator-soft-delete: deletedAt column already present';
  END IF;

  -- (2) Recreate the FK with ON DELETE RESTRICT.
  IF EXISTS (
    SELECT 1
      FROM information_schema.table_constraints
     WHERE table_name      = 'PlatformAuditLog'
       AND constraint_name = 'PlatformAuditLog_operator_fkey'
  ) THEN
    ALTER TABLE "PlatformAuditLog"
      DROP CONSTRAINT "PlatformAuditLog_operator_fkey";
    RAISE NOTICE 'platform-operator-soft-delete: dropped existing FK';
  END IF;

  ALTER TABLE "PlatformAuditLog"
    ADD CONSTRAINT "PlatformAuditLog_operator_fkey"
      FOREIGN KEY ("operatorId")
      REFERENCES "PlatformOperator"("id")
      ON DELETE RESTRICT
      ON UPDATE CASCADE;
  RAISE NOTICE 'platform-operator-soft-delete: FK recreated with ON DELETE RESTRICT';
END
$$;
