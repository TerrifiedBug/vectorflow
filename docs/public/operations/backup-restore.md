# Backup & Restore

VectorFlow includes built-in database backup and restore functionality. Backups capture the entire PostgreSQL database, including all pipelines, environments, users, secrets, audit history, and system settings.

## What gets backed up

Backups are full PostgreSQL dumps in compressed custom format (`pg_dump --format=custom`). Everything stored in the database is included:

- Pipeline definitions and version history
- Environments, teams, and user accounts
- Encrypted secrets and certificates
- Agent node registrations
- Alert rules and webhook configurations
- Audit log entries
- System settings (OIDC, fleet, backup schedule)

{% hint style="info" %}
Backups do **not** include the Vector data directory (`/var/lib/vector/`) on agent nodes. Vector's internal state (e.g., file checkpoints, disk buffers) is managed by each agent independently.
{% endhint %}

## Integrity verification

Every backup includes a SHA256 checksum computed after the database dump completes. Checksums are stored in the VectorFlow database alongside backup metadata.

When you restore a backup, VectorFlow automatically verifies the checksum before applying it:

- **Checksum matches** -- Restore proceeds normally
- **Checksum mismatch** -- Restore is blocked with an error message indicating the file may be corrupt

{% hint style="info" %}
Backups created before this feature was added (legacy backups) do not have stored checksums. VectorFlow skips checksum verification for these backups and proceeds with the restore.
{% endhint %}

## Remote Storage (S3)

VectorFlow can store backups in any S3-compatible storage service, including AWS S3, MinIO, DigitalOcean Spaces, and Backblaze B2.

### Configuring S3 storage

1. Navigate to **Settings > Backups**
2. Toggle the storage backend from **Local** to **S3**
3. Fill in the required fields:
   - **Bucket** -- the S3 bucket name
   - **Region** -- the AWS region (e.g., `us-east-1`)
   - **Access Key ID** -- IAM access key with S3 permissions
   - **Secret Access Key** -- corresponding secret key (stored encrypted)
4. Optional fields:
   - **Prefix** -- key prefix for organizing backups (e.g., `backups/vectorflow`)
   - **Endpoint URL** -- custom endpoint for MinIO or other S3-compatible services
5. Click **Test Connection** to verify bucket access and write permissions
6. Click **Save Storage Settings**

### How it works

- When S3 is configured, backups are uploaded to the S3 bucket immediately after creation. The local dump file is deleted after a successful upload to prevent disk exhaustion.
- Each backup's storage location is recorded in the database (`s3://bucket/key` for S3, local path for disk).
- Restoring from an S3-stored backup downloads the file temporarily, runs `pg_restore`, then deletes the temporary file.
- The backup table shows a cloud icon for S3-stored backups and a disk icon for local backups.
- Switching from S3 back to Local keeps your S3 credentials saved -- you can switch back without re-entering them.

### Required S3 permissions

The IAM user or role needs the following permissions on the target bucket:

- `s3:HeadBucket` (connection test)
- `s3:PutObject` (upload backups)
- `s3:GetObject` (download for restore)
- `s3:DeleteObject` (delete backups, cleanup test objects)
- `s3:HeadObject` (check if backup exists)

### MinIO and S3-compatible services

For self-hosted S3-compatible services like MinIO, set the **Endpoint URL** field to the service address (e.g., `https://minio.internal:9000`). VectorFlow automatically enables path-style addressing when a custom endpoint is set.

## Automatic backups

VectorFlow can run backups on a cron schedule with automatic retention cleanup.

### Configuring the schedule

Navigate to **Settings > Backup** (Super Admin required) to configure:

| Setting | Default | Description |
|---------|---------|-------------|
| Enabled | Off | Toggle automatic backups on or off |
| Cron Schedule | `0 2 * * *` | Standard cron expression. Default runs at 2:00 AM daily |
| Retention Count | 7 | Number of backups to keep. Older backups are automatically deleted |

**Common cron schedules:**

| Schedule | Cron Expression |
|----------|----------------|
| Every day at 2:00 AM | `0 2 * * *` |
| Every 6 hours | `0 */6 * * *` |
| Every day at midnight | `0 0 * * *` |
| Every Sunday at 3:00 AM | `0 3 * * 0` |
| Every weekday at 1:00 AM | `0 1 * * 1-5` |

After each scheduled backup completes, VectorFlow automatically runs retention cleanup to delete the oldest backups beyond the configured retention count.

### Monitoring backup health

The backup settings page shows the status of the most recent backup attempt:

- **Success** -- The last backup completed without errors. The timestamp and file size are displayed.
- **Failed** -- A red error banner appears at the top of the page showing the error message from the failed backup attempt (e.g., `pg_dump` timeout, disk full, permission denied). The banner persists until the next successful backup.

Failed backups are also visible in the backup list with a red **Failed** status badge and their error details. You can delete failed backup entries to clean them up. Download and Restore actions are only available for successful backups.

{% hint style="warning" %}
If automatic backups are enabled but consistently failing, the error banner provides the diagnostic message needed to troubleshoot. Common causes include insufficient disk space in `VF_BACKUP_DIR`, PostgreSQL connection issues, or `pg_dump` not being available in the container.
{% endhint %}

### Orphan cleanup

VectorFlow automatically detects and handles orphaned backup entries:

- **Files without database records** -- If a `.dump` file exists in the backup directory but has no matching database entry, it is automatically deleted during the next scheduled cleanup cycle.
- **Database records without files** -- If a backup record points to a file that no longer exists (locally or in S3), the record is marked as **Orphaned** in the backup list. Orphaned entries remain visible so operators can see what happened, and can be manually deleted.

Orphan cleanup runs alongside retention cleanup after each scheduled backup. No manual configuration is needed.

## Manual backup

You can trigger a backup at any time from the **Settings > Backup** page by clicking **Create Backup**. The backup runs immediately and appears in the backup list when complete.

The backup list is database-backed and shows all backups — both scheduled and manual — with their type, status, size, and duration. Backups persist across page refreshes and server restarts.

Each backup generates two files:
- `vectorflow-<timestamp>.dump` -- The compressed PostgreSQL dump
- `vectorflow-<timestamp>.meta.json` -- Metadata (VectorFlow version, migration count, PostgreSQL version, file size)

{% hint style="info" %}
When upgrading from a version before v1.2, any existing backup files in `VF_BACKUP_DIR` are automatically imported into the database on first startup. No manual action is required — your existing backups will appear in the list automatically.
{% endhint %}

## Downloading backups

Super Admins can download backup `.dump` files directly from the **Settings > Backup** page.

Each row in the backup list includes a **Download** button. Clicking it streams the compressed dump file to your browser. Downloaded files can be used for:

- Offline archival storage
- Restoring on a different VectorFlow instance via the CLI `pg_restore` procedure
- Disaster recovery from a separate machine

{% hint style="info" %}
The download button is only visible to Super Admins. The download streams the file directly from the server's backup directory — no temporary copies are created.
{% endhint %}

## Backup storage

Backups are stored on the server's local filesystem in the directory configured by the `VF_BACKUP_DIR` environment variable (default: `/backups`).

In the Docker Compose setup, this directory is mounted as a Docker volume:

```yaml
volumes:
  - backups:/backups
```

{% hint style="warning" %}
For production deployments, consider mounting `VF_BACKUP_DIR` to a location that is backed up by your infrastructure-level backup system (e.g., an NFS share, or a directory included in your host backup schedule).
{% endhint %}

## Restore procedure

Restoring from a backup replaces the entire database with the contents of the backup file.

{% hint style="danger" %}
**Restoring a backup overwrites all current data.** All pipelines, users, secrets, and settings will be replaced with the state from the backup. VectorFlow shows a preview of the backup contents and requires a typed confirmation before proceeding. A safety backup is created automatically before restoring.
{% endhint %}

### Restore from the UI

{% stepper %}
{% step %}
### Navigate to Settings > Backup
Open the backup management page (Super Admin required).
{% endstep %}
{% step %}
### Click Restore on a backup
Find the backup you want to restore in the list and click the **Restore** button. A preview dialog opens showing the backup's metadata.
{% endstep %}
{% step %}
### Review the preview
The preview shows:
- **VectorFlow version** and **migration level** from when the backup was created
- **PostgreSQL version** used for the dump
- **Backup size** and **creation date**
- **Tables present** in the dump file

This information helps you verify you are restoring the correct backup.
{% endstep %}
{% step %}
### Confirm the restore
Click **Continue to Confirmation**, then type `RESTORE` in the confirmation field and click **Restore Database**. VectorFlow will:
1. Validate version compatibility (blocks if the backup has more migrations than the current version)
2. Verify the backup file checksum
3. Create a safety backup of the current database
4. Run `pg_restore --clean --if-exists` to replace the database
{% endstep %}
{% step %}
### Restart the application
After restore completes, the dialog shows a success message. Restart the application for all changes to take full effect. If running in Docker, restart the container. Database migrations run automatically on startup.
{% endstep %}
{% endstepper %}

### Manual restore (CLI)

If you cannot access the UI, you can restore directly using `pg_restore`:

```bash
# Stop the VectorFlow server first
docker compose stop vectorflow

# Restore the backup
docker compose exec postgres pg_restore \
  --clean --if-exists \
  -U vectorflow -d vectorflow \
  /backups/vectorflow-2025-01-15T02-00-00-000Z.dump

# Restart the server (migrations run automatically)
docker compose start vectorflow
```

## Version compatibility

VectorFlow tracks the number of database migrations in each backup's metadata. When restoring:

- **Same version or older backup → newer server**: Works. Migrations run automatically on startup to bring the schema up to date.
- **Newer backup → older server**: Blocked. If the backup contains more migrations than the current server version, the restore is rejected. Upgrade VectorFlow first, then restore.

## Recommended backup strategy

1. **Enable automatic daily backups** with a retention count of at least 7.
2. **Mount the backup directory** to storage that is included in your infrastructure backup system.
3. **Test restores periodically** in a staging environment to verify your backups are valid.
4. **Create a manual backup** before upgrading VectorFlow or making major configuration changes.
5. **Monitor backup status** on the Settings page. Failed backups are logged with error details.
6. **Check server logs for disk space warnings.** Before each backup, VectorFlow checks available disk space in `VF_BACKUP_DIR` and logs a warning if it drops below the configured threshold (default: 500 MB). Configure the threshold with the `VF_BACKUP_DISK_WARN_MB` environment variable.

## Recovery targets (RTO/RPO)

Recovery Point Objective (RPO) defines the maximum acceptable data loss. Recovery Time Objective (RTO) defines the maximum acceptable downtime during recovery.

### Default targets

| Metric | Default Target | Basis |
|--------|---------------|-------|
| **RPO** (max data loss) | 24 hours | Default daily backup schedule (`0 2 * * *`) |
| **RTO** (time to recover) | < 15 minutes | pg_restore of < 1 GB database + container startup |

{% hint style="info" %}
These defaults assume the standard daily backup schedule and a database under 1 GB. Adjust targets based on your backup frequency and database size using the framework below.
{% endhint %}

### Calculating your targets

**RPO formula:**

```
RPO = backup_interval + backup_duration + transfer_time
```

- **backup_interval** — time between scheduled backups (e.g., 24h for daily, 6h for `0 */6 * * *`)
- **backup_duration** — time to complete `pg_dump` (typically seconds for < 1 GB)
- **transfer_time** — S3 upload time (0 for local storage)

Data created after the last successful backup and before a failure is at risk.

**RTO formula:**

```
RTO = download_time + restore_time + app_restart + smoke_test
```

- **download_time** — time to retrieve backup from S3 (0 for local storage)
- **restore_time** — `pg_restore` duration (see estimates below)
- **app_restart** — VectorFlow startup + automatic migration run (~30s typical)
- **smoke_test** — manual verification of application health (~2-5 min)

### Size-based RTO estimates

| Database Size | Local Restore | S3 Restore (100 Mbps) |
|--------------|---------------|----------------------|
| 100 MB | ~1 min | ~2 min |
| 500 MB | ~3 min | ~5 min |
| 1 GB | ~5 min | ~8 min |
| 5 GB | ~15 min | ~25 min |

{% hint style="info" %}
These estimates include `pg_restore` time and application restart. Actual times depend on disk speed, CPU, and network throughput. Run `scripts/dr-verify.sh` to benchmark your environment.
{% endhint %}

### Reducing RPO

Increase backup frequency by changing the cron schedule:

| Schedule | Cron Expression | RPO |
|----------|----------------|-----|
| Every 24 hours (default) | `0 2 * * *` | 24h |
| Every 12 hours | `0 2,14 * * *` | 12h |
| Every 6 hours | `0 */6 * * *` | 6h |
| Every hour | `0 * * * *` | 1h |

{% hint style="warning" %}
More frequent backups increase storage usage and I/O load. Adjust the retention count accordingly and monitor disk space warnings in the server logs.
{% endhint %}

### Reducing RTO

- **Keep local backup copies** alongside S3 to eliminate download time
- **Use faster storage** (SSD) for the backup directory
- **Pre-provision a standby PostgreSQL** instance to eliminate container startup time
- **Automate the runbook** using `scripts/dr-verify.sh` as a starting point
