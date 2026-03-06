# Configuration

VectorFlow is configured through environment variables (for the server and agents) and through the Settings page in the UI (for fleet tuning, OIDC, and backups).

## Server environment variables

### Required

{% hint style="warning" %}
These variables must be set before the server can start. Without them, the application will fail to launch.
{% endhint %}

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://vectorflow:pass@localhost:5432/vectorflow` |
| `NEXTAUTH_SECRET` | Session encryption key (min 32 characters) | Output of `openssl rand -base64 32` |

{% hint style="danger" %}
`NEXTAUTH_SECRET` is used to encrypt sessions, TOTP secrets, stored credentials, and all sensitive values in the database. Use a strong, random value and keep it safe. If you lose this key, all encrypted data becomes unrecoverable.
{% endhint %}

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXTAUTH_URL` | *(inferred from Host header)* | Canonical server URL. Set this when running behind a reverse proxy (e.g., `https://vectorflow.example.com`) |
| `PORT` | `3000` | HTTP listen port |
| `NODE_ENV` | `production` | Set automatically in Docker. Use `production` for standalone deployments |
| `VF_BACKUP_DIR` | `/backups` | Directory for database backup files |

### Docker Compose variables

When using the Docker Compose setup, these variables go in your `.env` file and are interpolated into the Compose file:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTGRES_PASSWORD` | Yes | -- | Password for the PostgreSQL `vectorflow` user |
| `VF_VERSION` | No | `latest` | Docker image tag to pull |

## Agent environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VF_URL` | Yes | -- | VectorFlow server URL (e.g., `https://vectorflow.example.com`) |
| `VF_TOKEN` | First run only | -- | Enrollment token from the environment detail page. Only needed for initial registration |
| `VF_DATA_DIR` | No | `/var/lib/vf-agent` | Data directory for configs, tokens, and certificates |
| `VF_VECTOR_BIN` | No | `vector` | Path to the Vector binary |
| `VF_POLL_INTERVAL` | No | `15s` | How often the agent polls the server for changes |
| `VF_LOG_LEVEL` | No | `info` | Logging verbosity: `debug`, `info`, `warn`, `error` |

## Database connection

VectorFlow requires PostgreSQL 17 or later. The connection is configured via `DATABASE_URL`.

**Connection string format:**

```
postgresql://[user]:[password]@[host]:[port]/[database]?[options]
```

**Common options:**

| Option | Description |
|--------|-------------|
| `sslmode=require` | Enforce TLS for the database connection |
| `connection_limit=10` | Limit the Prisma connection pool size |

## Example `.env` file

### Server (Docker Compose)

```bash
# Required
POSTGRES_PASSWORD=my-strong-database-password
NEXTAUTH_SECRET=Kj8mN2pQ4rT6vX9zA1cE3fG5hI7jL0nO2qR4sU6wY8

# Optional
NEXTAUTH_URL=https://vectorflow.example.com
VF_VERSION=latest
```

### Agent

```bash
# Required
VF_URL=https://vectorflow.example.com

# Only for first enrollment
VF_TOKEN=env_abc123_enrollment_token

# Optional
VF_DATA_DIR=/var/lib/vf-agent
VF_VECTOR_BIN=/usr/bin/vector
VF_POLL_INTERVAL=15s
VF_LOG_LEVEL=info
```

## System settings (UI)

The following settings are configured through the **Settings** page in the VectorFlow UI. Only Super Admins can access this page. These values are stored in the database and take effect immediately.

### Fleet settings

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| Poll Interval | 15,000 ms | 1,000--300,000 | How frequently agents check in with the server |
| Unhealthy Threshold | 3 | 1--100 | Number of missed heartbeats before an agent is marked **Unreachable** |
| Metrics Retention | 7 days | 1--365 | How long node and pipeline metrics are kept |
| Logs Retention | 3 days | 1--30 | How long pipeline logs are kept |

### Backup settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enabled | Off | Toggle automatic scheduled backups |
| Cron Schedule | `0 2 * * *` | Cron expression for backup timing (default: 2:00 AM daily) |
| Retention Count | 7 | Number of backups to keep before deleting the oldest |

For more details, see [Backup & Restore](backup-restore.md).

### OIDC / SSO settings

OIDC is configured in the Settings page under the **Authentication** tab. See [Authentication](authentication.md) for full setup instructions.

## Ports reference

| Service | Default Port | Description |
|---------|-------------|-------------|
| VectorFlow Server | 3000 | Web UI and API |
| PostgreSQL | 5432 | Database (not exposed externally in Docker) |
| Vector API | 8686 | Vector GraphQL API (per node, managed by agent) |

## File paths

### Server

| Path | Description |
|------|-------------|
| `/app/.vectorflow/` | Server data directory (Docker volume mount) |
| `/backups/` | Database backup storage (Docker volume mount) |

### Agent

| Path | Description |
|------|-------------|
| `/var/lib/vf-agent/` | Agent data directory (default) |
| `/var/lib/vf-agent/node-token` | Persistent authentication token (mode `0600`) |
| `/var/lib/vf-agent/pipelines/` | Pipeline configuration files |
| `/var/lib/vf-agent/certs/` | Deployed TLS certificates |
| `/var/lib/vector/` | Vector data directory |
