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
**Restoring a backup overwrites all current data.** All pipelines, users, secrets, and settings will be replaced with the state from the backup. This action cannot be undone (though VectorFlow automatically creates a safety backup before restoring).
{% endhint %}

### Restore from the UI

{% stepper %}
{% step %}
### Navigate to Settings > Backup
Open the backup management page (Super Admin required).
{% endstep %}
{% step %}
### Select a backup
Find the backup you want to restore in the list. Review the metadata (timestamp, VectorFlow version, size).
{% endstep %}
{% step %}
### Click Restore
Confirm the restore action. VectorFlow will:
1. Validate version compatibility (blocks if the backup has more migrations than the current version)
2. Create a safety backup of the current database
3. Run `pg_restore --clean --if-exists` to replace the database
4. Exit the process so the container restarts with the restored data
{% endstep %}
{% step %}
### Wait for restart
The server process exits after restore. If running in Docker, the container restarts automatically. Database migrations run on startup to bring the schema up to date.
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
