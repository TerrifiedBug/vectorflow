# Roadmap: VectorFlow

## Milestones

- ✅ **v1.0 Enterprise Scale** — Phases 1-7 (shipped 2026-03-27) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 UX Polish** — Phases 8-11 (shipped 2026-03-27) — [archive](milestones/v1.1-ROADMAP.md)
- 🔵 **v1.2 Production-Grade Backups** — Phases 12-15 (active)

## Phases

<details>
<summary>✅ v1.0 Enterprise Scale (Phases 1-7) — SHIPPED 2026-03-27</summary>

- [x] Phase 1: Fleet Performance Foundation (2/2 plans) — completed 2026-03-26
- [x] Phase 2: Fleet Organization (4/4 plans) — completed 2026-03-26
- [x] Phase 3: Fleet Health Dashboard (2/2 plans) — completed 2026-03-27
- [x] Phase 4: Outbound Webhooks (3/3 plans) — completed 2026-03-27
- [x] Phase 5: Cross-Environment Promotion UI (3/3 plans) — completed 2026-03-27
- [x] Phase 6: OpenAPI Specification (2/2 plans) — completed 2026-03-27
- [x] Phase 7: Cross-Environment Promotion GitOps (2/2 plans) — completed 2026-03-27

</details>

<details>
<summary>✅ v1.1 UX Polish (Phases 8-11) — SHIPPED 2026-03-27</summary>

- [x] Phase 8: Pipeline Folders in Sidebar (2/2 plans) — completed 2026-03-27
- [x] Phase 9: Alerts Page Categorization (2/2 plans) — completed 2026-03-27
- [x] Phase 10: Deployment Matrix Filters (2/2 plans) — completed 2026-03-27
- [x] Phase 11: Compliance Tags Rename (1/1 plan) — completed 2026-03-27

</details>

### v1.2 Production-Grade Backups

- [x] **Phase 12: Backup Registry Foundation** - BackupRecord table, error capture, disk checks, and checksums (completed 2026-03-27)
- [ ] **Phase 13: Backup Listing & History** - GUI queries database, reliable history without disappearing entries
- [x] **Phase 14: S3 Remote Storage** - S3-compatible backend with settings, upload, restore, and connection test (completed 2026-03-27)
- [ ] **Phase 15: Restore UX & Cleanup** - Preview, multi-step confirmation, progress, and orphan cleanup

## Phase Details

### Phase 12: Backup Registry Foundation
**Goal**: The backup system persists reliable metadata so all future backup operations have a trustworthy source of truth
**Depends on**: Nothing (foundation phase for this milestone)
**Requirements**: BREG-01, RELY-01, RELY-02, RELY-03
**Success Criteria** (what must be TRUE):
  1. Each backup operation creates a BackupRecord row capturing id, status, size, duration, storage location, error, and type
  2. When a backup fails, the full error detail is stored in BackupRecord and surfaces in the UI (no silent failures)
  3. Before a backup starts, available disk space is checked and a warning is shown if below the configured threshold
  4. Every completed backup has a SHA256 checksum stored alongside it that is verified automatically before any restore begins
**Plans:** 2/2 plans complete
Plans:
- [x] 12-01-PLAN.md — BackupRecord Prisma model, migration SQL, checkDiskSpace and computeChecksum helpers
- [x] 12-02-PLAN.md — createBackup/restoreFromBackup integration, scheduler fix, tests, docs

### Phase 13: Backup Listing & History
**Goal**: Operators can reliably see all their backups — scheduled and manual — with no entries disappearing from the GUI
**Depends on**: Phase 12
**Requirements**: BREG-02, BREG-03
**Success Criteria** (what must be TRUE):
  1. The backup list page queries the BackupRecord table instead of scanning the filesystem — entries never vanish between page loads
  2. Both scheduled and manual backups appear in the history list with status, size, duration, and timestamp
  3. A backup that was present on the previous page load is still present after refresh, even if the underlying file moved or the process restarted
**Plans:** 1/2 plans executed
Plans:
- [x] 13-01-PLAN.md — DB-backed listBackups, atomic delete, legacy import, retention fix, restore fallback, tests
- [ ] 13-02-PLAN.md — UI table columns (Type, Status, Duration), failed backup display, docs update
**UI hint**: yes

### Phase 14: S3 Remote Storage
**Goal**: Operators can direct all backups to an S3-compatible bucket and restore from it without touching the local filesystem
**Depends on**: Phase 12
**Requirements**: S3-01, S3-02, S3-03, S3-04
**Success Criteria** (what must be TRUE):
  1. User can enter S3 bucket, prefix, region, and credentials in settings and test the connection before saving
  2. User can toggle between Local and S3 storage backends; the active backend is clearly indicated in the UI
  3. After a backup completes with S3 configured, the file is present in the configured S3 bucket under the expected prefix
  4. User can select an S3-stored backup and restore from it — the file is downloaded and applied without manual steps
**Plans**: TBD
**UI hint**: yes

### Phase 15: Restore UX & Cleanup
**Goal**: Operators can restore confidently with full visibility into what they are about to apply, and the system automatically handles stale records and orphaned files
**Depends on**: Phase 13, Phase 14
**Requirements**: REST-01, REST-02, REST-03, BREG-04
**Success Criteria** (what must be TRUE):
  1. Before executing a restore, the user sees a preview showing team count, pipeline count, user count, environment count, VF version, and migration level from the backup
  2. Restore follows a select → preview → confirm → execute flow; there is no way to trigger a restore without passing through the confirmation step
  3. Restore shows a progress indicator and completes gracefully — the process does not call process.exit(0) or leave the UI in an ambiguous state
  4. The system detects orphaned backup files (dump without DB record) and DB records without files on a schedule and removes stale entries automatically
**Plans:** 1/2 plans executed
Plans:
- [x] 15-01-PLAN.md — previewBackup service, restoreFromBackup fix (no process.exit), runOrphanCleanup, Prisma migration, tRPC procedures, tests
- [ ] 15-02-PLAN.md — RestoreDialog multi-step UI component, orphaned badge, public docs update
**UI hint**: yes

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 12. Backup Registry Foundation | 2/2 | Complete    | 2026-03-27 |
| 13. Backup Listing & History | 1/2 | In Progress|  |
| 14. S3 Remote Storage | 0/? | Complete    | 2026-03-27 |
| 15. Restore UX & Cleanup | 1/2 | In Progress|  |
