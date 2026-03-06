# Quick Start

Get VectorFlow running in under 5 minutes. This guide walks you through starting the server with Docker Compose and completing the initial setup.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) (v2+)
- A machine with at least 1 CPU core and 1 GB RAM

{% stepper %}
{% step %}
### Download and configure

Create a directory for VectorFlow, download the Docker Compose file, and create an environment file with your secrets.

```bash
mkdir vectorflow && cd vectorflow

# Download the server compose file
curl -sSfL -o docker-compose.yml \
  https://raw.githubusercontent.com/TerrifiedBug/vectorflow/main/docker/server/docker-compose.yml
```

Create a `.env` file next to `docker-compose.yml`:

```bash
cat > .env << 'EOF'
# Database password — use a random 32+ character string
POSTGRES_PASSWORD=changeme

# Session & encryption key — generate with: openssl rand -base64 32
NEXTAUTH_SECRET=changeme
EOF
```

{% hint style="warning" %}
Replace both `changeme` values with strong, random strings before starting. You can generate them with:

```bash
openssl rand -base64 32
```
{% endhint %}

`NEXTAUTH_URL` is optional. When omitted, VectorFlow infers the URL from the incoming `Host` header. Set it explicitly if you place VectorFlow behind a reverse proxy (e.g., `https://vectorflow.example.com`).
{% endstep %}

{% step %}
### Start VectorFlow

```bash
docker compose up -d
```

Docker pulls the VectorFlow server and PostgreSQL images, runs database migrations automatically, and starts both services. You can follow the logs with:

```bash
docker compose logs -f vectorflow
```

Wait until you see `Starting VectorFlow...` in the output.
{% endstep %}

{% step %}
### Complete the setup wizard

Open your browser and navigate to [http://localhost:3000](http://localhost:3000).

The setup wizard walks you through creating your first admin account. Enter a username, email, and password, then click **Create Account**.

Once logged in, you land on the VectorFlow dashboard.
{% endstep %}
{% endstepper %}

{% hint style="success" %}
**You're ready!** VectorFlow is running and your admin account is set up. Time to deploy some agents and build your first pipeline.
{% endhint %}

## What's in the stack

The Docker Compose file starts two containers:

| Container | Image | Purpose |
|-----------|-------|---------|
| `vectorflow-server` | `ghcr.io/terrifiedbug/vectorflow-server` | Next.js application, tRPC API, pipeline validation |
| `vectorflow-postgres` | `postgres:17-alpine` | Database for pipelines, environments, users, and audit logs |

Three named volumes persist data across restarts:

- **`vectorflow-pgdata`** -- PostgreSQL data
- **`vectorflow-data`** -- VectorFlow application state
- **`vectorflow-backups`** -- Database backups

## Next steps

- [Deploy Agents](deploy-agents.md) -- enroll your first fleet node
- [Your First Pipeline](first-pipeline.md) -- build and deploy a pipeline in the visual editor
- [Deploy the Server](deploy-server.md) -- production deployment options, TLS, and environment variables
