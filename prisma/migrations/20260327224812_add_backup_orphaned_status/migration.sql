-- Documentation-only migration: adds "orphaned" as a valid BackupRecord.status value.
-- The status column is a plain String field — no enum type to migrate.
-- This comment serves as the migration record for the new status value.
COMMENT ON COLUMN "BackupRecord"."status" IS '"success" | "failed" | "in_progress" | "orphaned"';
