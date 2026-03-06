# Upgrading

VectorFlow is designed for zero-downtime upgrades. The server handles database migrations automatically on startup, and agents can self-update without manual intervention.

## Pre-upgrade checklist

Before upgrading, complete these steps:

- [ ] **Create a database backup** -- Navigate to Settings > Backup and click **Create Backup**, or verify that a recent automatic backup exists. See [Backup & Restore](backup-restore.md).
- [ ] **Review release notes** -- Check the [Releases](https://github.com/TerrifiedBug/vectorflow/releases) page for breaking changes, required actions, or migration notes.
- [ ] **Verify agent compatibility** -- Server and agent versions should be kept in sync. The server is backward-compatible with older agents, but newer agents may require a newer server.

## Version checking

VectorFlow automatically checks for new releases every 24 hours by querying the GitHub Releases API. When a new version is available, a notification appears on the Settings page showing:

- Current server version
- Latest available version
- Link to the release notes

You can force a version check from **Settings** by clicking **Check for Updates**.

## Server upgrade

The server upgrade process is the same regardless of how you deployed: replace the binary or image, restart, and migrations run automatically.

{% tabs %}
{% tab title="Docker" %}
### Docker upgrade

{% stepper %}
{% step %}
### Pull the new image
```bash
docker compose pull vectorflow
```

Or pin a specific version in your `.env` file:
```bash
VF_VERSION=v0.4.0
```
{% endstep %}
{% step %}
### Restart the server
```bash
docker compose up -d
```

The entrypoint runs `prisma migrate deploy` automatically. Database schema changes are applied before the application starts.
{% endstep %}
{% step %}
### Verify
Check the logs to confirm the server started successfully:
```bash
docker compose logs -f vectorflow
```

Look for the migration output and the "Ready" message.
{% endstep %}
{% endstepper %}

{% endtab %}
{% tab title="Standalone" %}
### Standalone upgrade

{% stepper %}
{% step %}
### Download the new release
```bash
curl -sSfL -o vectorflow.tar.gz \
  https://github.com/TerrifiedBug/vectorflow/releases/latest/download/vectorflow-server.tar.gz
```
{% endstep %}
{% step %}
### Stop the server
```bash
sudo systemctl stop vectorflow
```
{% endstep %}
{% step %}
### Extract the new release
```bash
tar xzf vectorflow.tar.gz -C /opt/vectorflow
```
{% endstep %}
{% step %}
### Run migrations
```bash
cd /opt/vectorflow
npx prisma migrate deploy
```
{% endstep %}
{% step %}
### Start the server
```bash
sudo systemctl start vectorflow
```
{% endstep %}
{% step %}
### Verify
```bash
sudo systemctl status vectorflow
journalctl -u vectorflow -f
```
{% endstep %}
{% endstepper %}

{% endtab %}
{% endtabs %}

## Agent upgrade

### Automatic self-update

Agents can update themselves automatically. When the server detects that a newer agent version is available, it includes a **self-update action** in the heartbeat response. The agent then:

1. Downloads the new binary from the release URL
2. Computes a SHA-256 checksum and verifies it against the expected value
3. Writes the new binary to a temporary file alongside the current executable
4. Atomically replaces the current binary (`rename`)
5. Re-executes the process (`syscall.Exec`) with the same arguments and environment

The update is seamless -- running Vector pipelines are not interrupted during the agent binary swap. After re-exec, the agent resumes its heartbeat loop with the new version.

{% hint style="info" %}
Self-update requires the agent binary to be writable by the process. If the agent runs as a restricted user, ensure it has write permission to its own executable path.
{% endhint %}

### Manual agent update

If automatic updates are not suitable for your environment, you can update agents manually:

{% tabs %}
{% tab title="Docker" %}
```bash
# Pull the new agent image
docker compose pull vf-agent

# Restart the agent
docker compose up -d vf-agent
```
{% endtab %}
{% tab title="Standalone" %}
```bash
# Download the new binary
curl -sSfL -o /usr/local/bin/vf-agent \
  https://github.com/TerrifiedBug/vectorflow/releases/latest/download/vf-agent-linux-amd64

# Make it executable
chmod +x /usr/local/bin/vf-agent

# Restart the agent
sudo systemctl restart vf-agent
```
{% endtab %}
{% endtabs %}

## Database migrations

VectorFlow uses Prisma ORM for database schema management. Migrations are:

- **Automatically applied** on server startup in the Docker image (the entrypoint runs `prisma migrate deploy`)
- **Forward-only** -- there is no automatic rollback of migrations
- **Non-destructive** where possible -- VectorFlow avoids dropping columns or tables in migrations

If a migration fails, the server will not start. Check the logs for the specific error and resolve it before restarting.

## Rollback

### Server rollback

If an upgrade causes issues, you can roll back to the previous version:

{% tabs %}
{% tab title="Docker" %}
Pin the previous version in your `.env` file and restart:

```bash
# Set the previous version
VF_VERSION=v0.3.0

# Restart with the old image
docker compose up -d
```

{% hint style="warning" %}
Rolling back the server after a database migration has run may cause errors if the application code expects the old schema. If migrations were applied, restore from a pre-upgrade backup instead.
{% endhint %}
{% endtab %}
{% tab title="Standalone" %}
Replace the application files with the previous release archive:

```bash
sudo systemctl stop vectorflow
tar xzf vectorflow-v0.3.0.tar.gz -C /opt/vectorflow
sudo systemctl start vectorflow
```

If database migrations were applied, restore from a backup:

```bash
# Stop the server
sudo systemctl stop vectorflow

# Restore the pre-upgrade backup
pg_restore --clean --if-exists \
  -U vectorflow -d vectorflow \
  /backups/vectorflow-pre-upgrade.dump

# Start the old version
sudo systemctl start vectorflow
```
{% endtab %}
{% endtabs %}

### Agent rollback

For Docker-based agents, pin the previous image tag. For standalone agents, replace the binary with the previous version:

```bash
# Download the specific previous version
curl -sSfL -o /usr/local/bin/vf-agent \
  https://github.com/TerrifiedBug/vectorflow/releases/download/v0.3.0/vf-agent-linux-amd64

chmod +x /usr/local/bin/vf-agent
sudo systemctl restart vf-agent
```

## Version compatibility

| Server Version | Minimum Agent Version | Notes |
|---------------|----------------------|-------|
| Current | Current - 2 minor versions | Agents within 2 minor versions of the server are fully supported |

{% hint style="info" %}
The server is generally backward-compatible with older agents. Older agents may not support newer features (e.g., new pipeline actions), but they will continue to run existing pipelines without issues. It is recommended to keep agents updated to match the server version.
{% endhint %}
