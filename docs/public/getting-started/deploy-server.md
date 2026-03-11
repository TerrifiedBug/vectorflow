# Deploy the Server

The VectorFlow server is a Next.js application backed by PostgreSQL. This page covers deployment options, environment variables, persistent storage, and production hardening.

{% tabs %}
{% tab title="Docker (recommended)" %}
## Docker Compose

The quickest path to production. The provided `docker-compose.yml` starts both the VectorFlow server and PostgreSQL.

### 1. Download the Compose file

```bash
mkdir -p vectorflow && cd vectorflow

curl -sSfL -o docker-compose.yml \
  https://raw.githubusercontent.com/TerrifiedBug/vectorflow/main/docker/server/docker-compose.yml
```

### 2. Create your `.env` file

```bash
cat > .env << 'EOF'
POSTGRES_PASSWORD=<random-32-char-string>
NEXTAUTH_SECRET=<random-32-char-string>
# NEXTAUTH_URL=https://vectorflow.example.com
EOF
```

Generate secrets with `openssl rand -base64 32`.

### 3. Start the stack

```bash
docker compose up -d
```

The entrypoint automatically runs database migrations on every start, so upgrades are handled by pulling a new image and restarting.

### Compose file breakdown

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: vectorflow
      POSTGRES_USER: vectorflow
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vectorflow"]
    restart: unless-stopped

  vectorflow:
    image: ghcr.io/terrifiedbug/vectorflow-server:${VF_VERSION:-latest}
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://vectorflow:${POSTGRES_PASSWORD}@postgres:5432/vectorflow
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET}
      NEXTAUTH_URL: ${NEXTAUTH_URL}
    volumes:
      - vfdata:/app/.vectorflow
      - backups:/backups
    restart: unless-stopped

volumes:
  pgdata:
  vfdata:
  backups:
```

### Persistent volumes

| Volume | Mount point | Contents |
|--------|-------------|----------|
| `vectorflow-pgdata` | `/var/lib/postgresql/data` | PostgreSQL database files |
| `vectorflow-data` | `/app/.vectorflow` | Application state, system Vector config |
| `vectorflow-backups` | `/backups` | Database backup snapshots |

{% hint style="warning" %}
Never delete the `vectorflow-pgdata` volume without a backup. All pipeline definitions, environments, users, and audit history live in PostgreSQL.
{% endhint %}

### Pinning a version

By default the Compose file pulls `latest`. To pin a specific release:

```bash
VF_VERSION=v0.3.0 docker compose up -d
```

Or set `VF_VERSION` in your `.env` file.

### Networking

The server listens on port 3000. The PostgreSQL port is not exposed by default -- only the VectorFlow container can reach it over the internal Docker network. If you need direct database access for debugging:

```yaml
# Uncomment in docker-compose.yml
ports:
  - "127.0.0.1:5432:5432"
```
{% endtab %}

{% tab title="Standalone" %}
## Standalone deployment

Run VectorFlow directly on a Linux host without Docker. This approach gives you full control over the process manager, database, and networking.

### Prerequisites

- **Node.js 22+** and **pnpm**
- **PostgreSQL 17** (running and accessible)
- **Vector 0.44.0+** binary (for pipeline validation and VRL testing)

### 1. Download the release

Download the latest release archive from the [Releases](https://github.com/TerrifiedBug/vectorflow/releases) page and extract it.

```bash
curl -sSfL -o vectorflow.tar.gz \
  https://github.com/TerrifiedBug/vectorflow/releases/latest/download/vectorflow-server.tar.gz
mkdir -p /opt/vectorflow && tar xzf vectorflow.tar.gz -C /opt/vectorflow
```

### 2. Set up PostgreSQL

Create a database and user:

```sql
CREATE USER vectorflow WITH PASSWORD 'your-strong-password';
CREATE DATABASE vectorflow OWNER vectorflow;
```

### 3. Configure environment

Create an environment file at `/etc/vectorflow/server.env`:

```bash
DATABASE_URL=postgresql://vectorflow:your-strong-password@localhost:5432/vectorflow
NEXTAUTH_SECRET=generate-a-random-32-char-string
NEXTAUTH_URL=https://vectorflow.example.com
PORT=3000
NODE_ENV=production
```

### 4. Run database migrations

```bash
cd /opt/vectorflow
npx prisma migrate deploy
```

### 5. Start the server

```bash
node server.js
```

### Systemd service

For production, run VectorFlow as a systemd service:

```ini
# /etc/systemd/system/vectorflow.service
[Unit]
Description=VectorFlow Server
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=vectorflow
Group=vectorflow
WorkingDirectory=/opt/vectorflow
EnvironmentFile=/etc/vectorflow/server.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/vectorflow/.vectorflow /backups

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vectorflow
```
{% endtab %}
{% endtabs %}

## Environment variables

{% hint style="warning" %}
Always use strong, random values for `NEXTAUTH_SECRET` and `POSTGRES_PASSWORD`. These protect session data, encrypted secrets (TOTP, certificates), and your database.
{% endhint %}

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | -- | PostgreSQL connection string (e.g., `postgresql://user:pass@host:5432/vectorflow`) |
| `NEXTAUTH_SECRET` | Yes | -- | Session encryption key. Must be 32+ characters. Generate with `openssl rand -base64 32` |
| `NEXTAUTH_URL` | No | -- | Canonical server URL (e.g., `https://vectorflow.example.com`). When unset, inferred from the `Host` header |
| `PORT` | No | `3000` | HTTP listen port |
| `NODE_ENV` | No | `production` | Set automatically in Docker. Use `production` for standalone deployments |

When using the Docker Compose setup, the following variables go in your `.env` file and are interpolated into the Compose file:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTGRES_PASSWORD` | Yes | -- | Password for the PostgreSQL `vectorflow` user |
| `VF_VERSION` | No | `latest` | Docker image tag to pull |

## Production considerations

### Reverse proxy

In production, place VectorFlow behind a reverse proxy for TLS termination.

<details>
<summary>Nginx example</summary>

```nginx
server {
    listen 443 ssl http2;
    server_name vectorflow.example.com;

    ssl_certificate     /etc/ssl/certs/vectorflow.crt;
    ssl_certificate_key /etc/ssl/private/vectorflow.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE streaming support (agent push channel)
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_cache off;
    }
}
```
</details>

<details>
<summary>Caddy example</summary>

```
vectorflow.example.com {
    reverse_proxy localhost:3000
}
```

Caddy handles TLS certificates automatically via Let's Encrypt.
</details>

When using a reverse proxy, set `NEXTAUTH_URL` to your public URL (e.g., `https://vectorflow.example.com`).

### TLS

- **Agents communicate with the server over HTTPS.** Always terminate TLS in production.
- If you cannot use a reverse proxy, consider a TLS-terminating load balancer.

### Database tuning

For deployments managing more than 50 agents, consider tuning PostgreSQL:

- Increase `shared_buffers` to 25% of available RAM
- Set `work_mem` to 64 MB
- Enable `pg_stat_statements` for query monitoring
- Schedule regular `VACUUM ANALYZE` runs

### Resource requirements

| Scale | CPU | RAM | Disk |
|-------|-----|-----|------|
| Small (1-10 agents) | 1 core | 1 GB | 10 GB |
| Medium (10-50 agents) | 2 cores | 2 GB | 25 GB |
| Large (50+ agents) | 4 cores | 4 GB | 50 GB+ |

These are minimums. The server is lightweight -- most resources go to PostgreSQL.
