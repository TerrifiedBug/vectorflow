# Requirements: VectorFlow

**Defined:** 2026-03-27
**Core Value:** A corporate platform team can manage their entire Vector pipeline fleet at scale — organizing, promoting, and operating hundreds of pipelines across environments — without outgrowing VectorFlow.

## v1.2 Requirements

Requirements for v1.2 Production-Grade Backups. Each maps to roadmap phases.

### Backup Registry

- [x] **BREG-01**: Backup metadata is persisted in a BackupRecord database table (id, status, size, duration, storage location, error, type)
- [x] **BREG-02**: Backup listing in the GUI queries the database instead of scanning the filesystem
- [x] **BREG-03**: User can see all backup history (scheduled and manual) reliably without entries disappearing
- [ ] **BREG-04**: Orphaned backup files (dump without DB record, or DB record without file) are detected and cleaned up automatically

### Remote Storage

- [x] **S3-01**: User can configure S3-compatible storage (bucket, prefix, region, credentials) as the backup destination
- [x] **S3-02**: Backup files are uploaded to the configured S3 bucket after creation
- [x] **S3-03**: User can restore from a backup stored in S3 (downloaded and applied)
- [ ] **S3-04**: User can toggle between Local and S3 storage backends in settings with connection test and credential validation

### Restore Experience

- [ ] **REST-01**: User can preview backup contents before restoring (team count, pipeline count, user count, environment count, VF version, migration level)
- [ ] **REST-02**: Restore follows a multi-step confirmation flow (select → preview → confirm → execute)
- [ ] **REST-03**: Restore shows progress and completes gracefully without process.exit(0)

### Reliability

- [x] **RELY-01**: Backup errors are fully captured in the BackupRecord with details surfaced in the UI and alerts that properly await
- [x] **RELY-02**: Backup creation checks available disk space before starting and warns if below threshold
- [x] **RELY-03**: SHA256 checksum is stored with each backup and verified before restore

## Future Requirements

### Backup Enhancements

- **BKUP-01**: Azure Blob Storage as backup destination
- **BKUP-02**: Google Cloud Storage as backup destination
- **BKUP-03**: Backup health dashboard with success/failure history chart
- **BKUP-04**: S3 lifecycle policy documentation for long-term retention
- **BKUP-05**: Configurable pg_dump/pg_restore timeouts via environment variables
- **BKUP-06**: Post-restore banner showing what was restored after container restart
- **BKUP-07**: Redis distributed lock for backup operations in multi-instance deployments

## Out of Scope

| Feature | Reason |
|---------|--------|
| Azure Blob Storage | Defer to future milestone — S3-compatible covers most enterprise needs |
| Google Cloud Storage | Defer to future milestone — S3-compatible covers most enterprise needs |
| Redis distributed lock | Leader-only scheduling is acceptable for current HA model |
| Configurable timeouts | Low priority — can be added as env vars later without schema changes |
| Post-restore banner | Requires persistent state across container restarts — complex for low value |
| Backup encryption at rest | S3 server-side encryption handles this; local backups inherit disk encryption |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| BREG-01 | Phase 12 | Complete |
| RELY-01 | Phase 12 | Complete |
| RELY-02 | Phase 12 | Complete |
| RELY-03 | Phase 12 | Complete |
| BREG-02 | Phase 13 | Complete |
| BREG-03 | Phase 13 | Complete |
| S3-01 | Phase 14 | Complete |
| S3-02 | Phase 14 | Complete |
| S3-03 | Phase 14 | Complete |
| S3-04 | Phase 14 | Pending |
| REST-01 | Phase 15 | Pending |
| REST-02 | Phase 15 | Pending |
| REST-03 | Phase 15 | Pending |
| BREG-04 | Phase 15 | Pending |

**Coverage:**
- v1.2 requirements: 14 total
- Mapped to phases: 14
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-27*
*Last updated: 2026-03-27 after roadmap creation (v1.2)*
