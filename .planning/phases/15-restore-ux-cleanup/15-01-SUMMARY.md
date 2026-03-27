---
phase: 15-restore-ux-cleanup
plan: "01"
subsystem: backup
tags: [backup, restore, preview, orphan-cleanup, tRPC]
dependency_graph:
  requires: [14-02-SUMMARY.md]
  provides: [previewBackup tRPC query, runOrphanCleanup service, graceful restore return]
  affects: [src/server/services/backup.ts, src/server/services/backup-scheduler.ts, src/server/routers/settings.ts]
tech_stack:
  added: []
  patterns: [TDD red-green, module-level locking flags, pg_restore --list parsing]
key_files:
  created:
    - prisma/migrations/20260327224812_add_backup_orphaned_status/migration.sql
  modified:
    - src/server/services/backup.ts
    - src/server/services/backup-scheduler.ts
    - src/server/routers/settings.ts
    - src/server/services/__tests__/backup.test.ts
    - prisma/schema.prisma
decisions:
  - previewBackup uses .query() not .mutation() — transient S3 I/O is acceptable side effect for read procedure
  - restoreInProgress lock placed before sanitizeFilename() for immediate fast-fail on concurrent calls
  - runOrphanCleanup runs in a try/catch in scheduler so backup cron failure doesn't abort the cleanup step
  - pg_restore --list needs no PGPASSWORD since it reads the dump file only (no DB connection)
metrics:
  duration: "~17 minutes"
  completed: "2026-03-27T22:53:29Z"
  tasks_completed: 2
  files_modified: 5
  files_created: 1
---

# Phase 15 Plan 01: Backend Service Layer for Restore UX Summary

**One-liner:** Backup service layer extended with previewBackup (pg_restore --list parsing), graceful restoreFromBackup (returns { success: true } instead of process.exit), and runOrphanCleanup (bidirectional stale artifact cleanup).

## What Was Built

### Service changes (src/server/services/backup.ts)
- **BackupPreview interface** — exported type with `filename, vfVersion, migrationCount, lastMigration, sizeBytes, pgVersion, startedAt, tablesPresent`
- **previewBackup(filename)** — looks up success BackupRecord, downloads S3 to temp if needed, runs `pg_restore --list`, parses TABLE DATA lines into deduplicated `tablesPresent` array, cleans up temp in finally block
- **restoreInProgress flag** — module-level boolean that blocks concurrent restores and prevents restore-during-backup
- **restoreFromBackup** — return type changed from `Promise<void>` to `Promise<{ success: true }>`, `process.exit(0)` replaced with graceful log + return, `restoreInProgress` released in finally block
- **runOrphanCleanup()** — Direction 1: scans BACKUP_DIR for .dump files with no BackupRecord and deletes them; Direction 2: queries success BackupRecords, checks local file/S3 existence, marks missing as "orphaned"; returns `{ filesDeleted, recordsOrphaned }`

### Scheduler changes (src/server/services/backup-scheduler.ts)
- Imported `runOrphanCleanup` and `debugLog`
- Added orphan cleanup call in a try/catch after `runRetentionCleanup()` — errors are logged but do not interrupt the backup cron lifecycle

### Router changes (src/server/routers/settings.ts)
- Added `previewBackup` import
- Added `previewBackup` tRPC query procedure with `requireSuperAdmin()` auth, accepting `{ filename: string }` input

### Schema changes (prisma/schema.prisma)
- Updated `BackupRecord.status` comment to include `"orphaned"` as a valid value
- Created documentation-only migration `20260327224812_add_backup_orphaned_status`

## Tests

All 34 tests pass. New test coverage added:
- `describe("previewBackup")` — 4 tests: local preview with table parsing, not-found throws, S3 temp download+cleanup, deduplication
- `describe("restoreFromBackup - graceful")` — 2 tests: returns `{ success: true }`, throws on concurrent restore attempt
- `describe("runOrphanCleanup")` — 5 tests: file deletion, non-.dump ignored, local orphan mark, S3 orphan mark, no-op case
- Updated existing `restoreFromBackup` tests to expect `{ success: true }` instead of `resolves.toBeUndefined()`
- Removed `process.exit` spies from existing tests (no longer needed)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All BackupPreview fields are populated from BackupRecord data; tablesPresent is populated from pg_restore --list output.

## Self-Check: PASSED

Files created/modified:
- `src/server/services/backup.ts` — modified (verified BackupPreview, previewBackup, runOrphanCleanup, restoreInProgress, no process.exit)
- `src/server/services/backup-scheduler.ts` — modified (verified runOrphanCleanup import and call)
- `src/server/routers/settings.ts` — modified (verified previewBackup query procedure)
- `src/server/services/__tests__/backup.test.ts` — modified (verified 34 tests pass)
- `prisma/schema.prisma` — modified (verified "orphaned" in comment)
- `prisma/migrations/20260327224812_add_backup_orphaned_status/migration.sql` — created

Commits:
- `6c12c19` — test(15-01): add failing tests
- `1d76170` — feat(15-01): add previewBackup, fix restoreFromBackup, add runOrphanCleanup
- `c9d70eb` — feat(15-01): add previewBackup tRPC query procedure to settings router
