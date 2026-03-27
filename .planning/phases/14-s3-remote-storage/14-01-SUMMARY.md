---
phase: 14-s3-remote-storage
plan: 01
subsystem: database
tags: [s3, aws-sdk, prisma, backup, storage-backend, minio]

# Dependency graph
requires:
  - phase: 12-backup-registry-foundation
    provides: BackupRecord model and createBackup/restoreFromBackup with DB tracking
  - phase: 13-backup-listing-history
    provides: DB-backed listBackups, importLegacyBackups, deleteBackup with record cleanup
provides:
  - StorageBackend interface with upload/download/delete/exists methods
  - LocalBackend wrapping existing filesystem operations
  - S3Backend using @aws-sdk/client-s3 with forcePathStyle for MinIO support
  - S3 fields on SystemSettings (backupStorageBackend, s3Bucket, s3Region, s3Prefix, s3AccessKeyId, s3SecretAccessKey, s3Endpoint)
  - getActiveBackend() factory reading SystemSettings and returning appropriate backend
  - createBackup routes to S3 upload + local cleanup when configured
  - restoreFromBackup downloads from S3 to temp file and always cleans up in finally block
  - deleteBackup routes to S3 backend.delete() or local fs.unlink based on storageLocation
affects: [14-02, 14-03, 15-restore-ux-cleanup]

# Tech tracking
tech-stack:
  added: ["@aws-sdk/client-s3 ^3.1019.0"]
  patterns:
    - "StorageBackend interface pattern — LocalBackend and S3Backend are interchangeable"
    - "getActiveBackend() factory reads SystemSettings to select backend at runtime"
    - "S3 credentials stored encrypted in SystemSettings via crypto.ts AES-256-GCM"
    - "forcePathStyle: !!config.endpoint — auto-enables path-style for MinIO/custom endpoints"
    - "ContentLength set explicitly on PutObjectCommand to prevent SDK retry-hang on streams"
    - "S3 restore uses try/finally to guarantee temp file deletion"

key-files:
  created:
    - src/server/services/storage-backend.ts
    - prisma/migrations/20260327300000_add_s3_storage_fields/migration.sql
  modified:
    - prisma/schema.prisma
    - src/server/services/backup.ts
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "S3 upload is synchronous — backup not complete until file is in configured storage"
  - "Local file deleted after successful S3 upload to prevent disk exhaustion"
  - "forcePathStyle auto-enabled when custom endpoint is set (MinIO, DigitalOcean Spaces)"
  - "ContentLength MUST be set on PutObjectCommand to prevent SDK retry-hang on Node.js streams"
  - "Temp file for S3 restore named s3-restore-{timestamp}-{filename} to avoid collisions"
  - "getActiveBackend falls back to LocalBackend when S3 not configured — backward compatible"

patterns-established:
  - "StorageBackend abstraction: swap backends without changing caller code"
  - "S3 secret decrypted at backend construction time, never stored in plaintext"

requirements-completed: [S3-01, S3-02, S3-03]

# Metrics
duration: 11min
completed: 2026-03-27
---

# Phase 14 Plan 01: S3 Remote Storage Data Layer Summary

**StorageBackend abstraction with S3Backend (AWS SDK v3) and LocalBackend, wired into createBackup/restoreFromBackup/deleteBackup with automatic S3 routing based on SystemSettings**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-27T22:16:34Z
- **Completed:** 2026-03-27T22:27:46Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Installed `@aws-sdk/client-s3` and created `storage-backend.ts` with `StorageBackend` interface, `LocalBackend`, and `S3Backend` classes
- Added 7 S3 fields to `SystemSettings` in Prisma schema with migration SQL
- Wired S3-aware storage into `createBackup`, `restoreFromBackup`, and `deleteBackup` with full backward compatibility

## Task Commits

Each task was committed atomically:

1. **Task 1: Install SDK, add Prisma migration, create StorageBackend** - `c7cae6c` (feat)
2. **Task 2: Wire storage backends into backup.ts** - `69a8307` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/server/services/storage-backend.ts` - StorageBackend interface, LocalBackend, S3Backend, getActiveBackend, buildS3Key, buildS3StorageLocation, parseS3StorageLocation
- `prisma/migrations/20260327300000_add_s3_storage_fields/migration.sql` - ALTER TABLE statements for 7 S3 columns
- `prisma/schema.prisma` - backupStorageBackend, s3Bucket, s3Region, s3Prefix, s3AccessKeyId, s3SecretAccessKey, s3Endpoint fields on SystemSettings
- `src/server/services/backup.ts` - S3-aware createBackup, restoreFromBackup, deleteBackup
- `package.json` / `pnpm-lock.yaml` - @aws-sdk/client-s3 dependency

## Decisions Made

- **ContentLength critical:** Set explicitly on PutObjectCommand to prevent SDK retry-hang when piping Node.js ReadStream — without it, the SDK can't determine stream length and retries indefinitely
- **forcePathStyle auto-detect:** `forcePathStyle: !!config.endpoint` means custom endpoint automatically gets path-style (required for MinIO/Spaces), AWS S3 keeps virtual-hosted-style
- **Delete local after S3 upload:** Local .dump and .meta.json deleted after successful upload to prevent disk exhaustion in containerized deployments
- **Rebase on main:** Worktree was branched from pre-Phase-12/13 base; rebased on main to pick up BackupRecord migration and updated backup.ts before proceeding with Task 2

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Rebased worktree on main to pick up Phase 12/13 backup.ts changes**
- **Found during:** Task 2 setup
- **Issue:** Worktree was branched from commit 31fde91 (pre Phase 12/13). Phase 12/13 work (BackupRecord model, updated backup.ts) existed only on main branch, not in worktree
- **Fix:** Ran `git rebase main` to bring Phase 12/13 changes into the worktree before modifying backup.ts
- **Files modified:** All Phase 12/13 files rebased, no merge conflicts
- **Verification:** backup.ts showed full BackupRecord integration after rebase; tsc --noEmit passed with 0 errors
- **Committed in:** c7cae6c (rebase applied before Task 1 commit; hash updated to c7cae6c after rebase)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Rebase was required for correctness — Task 2 would have modified an outdated backup.ts without the BackupRecord integration. No scope creep.

## Issues Encountered

- `prisma migrate dev` required DATABASE_URL which isn't available in local dev worktree — resolved by creating migration SQL manually following the established pattern from Phase 12 migrations
- Worktree initially had `src/generated/prisma` not yet generated — ran `npx prisma generate` to create it before TypeScript check

## Next Phase Readiness

- StorageBackend abstraction ready for Plan 02 (tRPC settings procedures for S3 config + connection test)
- Plan 03 (UI for storage backend toggle + S3 credentials form) can build on the tRPC procedures
- All acceptance criteria met: StorageBackend, LocalBackend, S3Backend exported; getActiveBackend reads SystemSettings; backup.ts routes to correct backend; TypeScript compiles with 0 errors

---
*Phase: 14-s3-remote-storage*
*Completed: 2026-03-27*
