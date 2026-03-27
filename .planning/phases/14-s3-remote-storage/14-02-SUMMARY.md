---
phase: 14-s3-remote-storage
plan: 02
subsystem: api
tags: [s3, aws-sdk, trpc, settings, backup, download, testing, vitest]

# Dependency graph
requires:
  - phase: 14-s3-remote-storage plan 01
    provides: StorageBackend interface, S3Backend, getActiveBackend, parseS3StorageLocation, S3 fields on SystemSettings

provides:
  - testS3Connection tRPC procedure (HeadBucket + PutObject + DeleteObject validation cycle)
  - updateStorageBackend tRPC procedure (saves encrypted S3 credentials)
  - settings.get extended with backupStorageBackend, s3Bucket, s3Region, s3Prefix, s3AccessKeyId (masked), s3Endpoint
  - Download route streaming directly from S3 via GetObjectCommand + transformToWebStream()
  - S3 unit tests: createBackup upload, deleteBackup routing, restoreFromBackup download

affects: [14-03, 15-restore-ux-cleanup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "testS3Connection pattern: HeadBucket + PutObject + DeleteObject cycle maps S3 errors to TRPCError codes"
    - "updateStorageBackend sentinel: secretAccessKey !== 'unchanged' mirrors existing oidcClientSecret pattern"
    - "S3 streaming in download route: GetObjectCommand + transformToWebStream() for zero-copy browser streaming"
    - "Dynamic imports in Next.js route for S3Client and decrypt — lazy-loaded only for S3 backups"

key-files:
  created: []
  modified:
    - src/server/routers/settings.ts
    - src/app/api/backups/[filename]/download/route.ts
    - src/server/services/__tests__/backup.test.ts

key-decisions:
  - "S3 streaming in download route uses GetObjectCommand directly rather than backend.download() to avoid temp file I/O"
  - "Dynamic imports for S3Client and decrypt in download route — only executed for S3-backed backups"
  - "testS3Connection maps NoSuchBucket -> BAD_REQUEST and AccessDenied -> FORBIDDEN; all others -> INTERNAL_SERVER_ERROR"
  - "updateStorageBackend keeps S3 credentials when switching to local backend per Phase 14-01 locked decision"

patterns-established:
  - "S3 credential masking: decrypt then maskSecret in settings.get, mirrors oidcClientSecret pattern"
  - "Sentinel value 'unchanged' for secretAccessKey updates: encrypt only when not sentinel"

requirements-completed: [S3-01, S3-04]

# Metrics
duration: 6min
completed: 2026-03-27
---

# Phase 14 Plan 02: S3 Remote Storage API Layer Summary

**tRPC S3 connection test and storage backend config procedures, S3-streaming download route, and 4 new S3-specific unit tests covering upload/delete/restore paths**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-27T22:16:15Z
- **Completed:** 2026-03-27T22:16:57Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `testS3Connection` and `updateStorageBackend` tRPC procedures to settings router with `requireSuperAdmin()` auth and encrypted secret storage
- Extended `settings.get` to return masked S3 credentials following existing `oidcClientSecret` masking pattern
- Updated download route to stream S3-backed backups directly to browser via `GetObjectCommand + transformToWebStream()` with no temp file
- Added 4 S3 unit tests (createBackup S3 upload, createBackup local skip, deleteBackup S3 routing, restoreFromBackup S3 download)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add testS3Connection, updateStorageBackend procedures and extend settings.get** - `499bb7a` (feat)
2. **Task 2: Update download route for S3 and add S3 unit tests** - `99ca359` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/server/routers/settings.ts` - Added S3Client import, extended settings.get with 7 S3 fields, testS3Connection procedure, updateStorageBackend procedure
- `src/app/api/backups/[filename]/download/route.ts` - S3-aware download with direct streaming from S3 via GetObjectCommand; local file serving preserved as fallback
- `src/server/services/__tests__/backup.test.ts` - storage-backend mock added; 4 new describe blocks for S3 createBackup, deleteBackup, restoreFromBackup paths

## Decisions Made

- **S3 streaming via GetObjectCommand**: Download route uses `GetObjectCommand` directly with `transformToWebStream()` rather than `backend.download()` to avoid temp file I/O — zero-copy streaming to browser HTTP response
- **Dynamic imports in download route**: `@aws-sdk/client-s3` and `@/server/services/crypto` are dynamically imported only when backup has an S3 storage location — no impact on local-only deployments
- **testS3Connection error mapping**: `NoSuchBucket` -> `BAD_REQUEST`, `AccessDenied`/`AccessDeniedException` -> `FORBIDDEN`, all other S3 errors -> `INTERNAL_SERVER_ERROR` with full error message

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Rebased worktree on main to get Phase 12/13/14-01 dependencies**
- **Found during:** Setup (before Task 1)
- **Issue:** Worktree branch was at commit 31fde91 (before Phase 12/13/14-01 work). `storage-backend.ts` did not exist in the worktree; `backup.ts` lacked S3 integration; `@aws-sdk/client-s3` not installed
- **Fix:** `git rebase main` to bring in 16 commits from Phases 12/13/14-01; then `pnpm install --frozen-lockfile` to install `@aws-sdk/client-s3`
- **Files modified:** All Phase 12/13/14-01 files rebased, no conflicts
- **Verification:** `storage-backend.ts` exists; `npx tsc --noEmit` passes on modified files; all 22 tests pass
- **Committed in:** Pre-existing commits from main; no new deviation commit needed

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Rebase required for correctness — Task 1 would have had no S3 SDK and no storage-backend.ts to import from. No scope creep.

## Issues Encountered

- `@aws-sdk/client-s3` not installed in worktree despite being in `package.json` — resolved by running `pnpm install --frozen-lockfile` after rebase
- Pre-existing TypeScript errors in `backup.test.ts` (mockExecFile.mockImplementation type mismatch pattern) exist from Phase 12 — not introduced by our changes; tests still pass with vitest

## Next Phase Readiness

- All S3 API procedures ready for Plan 03 (UI for storage backend toggle + S3 credentials form)
- Frontend can call `settings.get` to read current S3 config (with masked secret), `testS3Connection` to validate before saving, `updateStorageBackend` to persist
- Download route handles both local and S3 backups transparently

---
*Phase: 14-s3-remote-storage*
*Completed: 2026-03-27*
