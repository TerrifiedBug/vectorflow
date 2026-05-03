# QA Dev Environment

Use this path when reviewing frontend changes that need a live browser session
against seeded Vectorflow data.

## One Command

```bash
pnpm dev:qa
```

The command:

1. Starts the PostgreSQL container from `e2e/docker-compose.e2e.yml`.
2. Runs `prisma migrate deploy`.
3. Runs `pnpm seed:qa`.
4. Starts Next.js on `http://localhost:3000` with `DEV_AUTH_BYPASS=1`.

The seeded pipeline is available at:

```text
http://localhost:3000/pipelines/qa-pipeline
```

## Prerequisites

- Node.js 22+ and pnpm 10+
- Docker daemon access with Docker Compose v2
- Port `5433` available for PostgreSQL
- Port `3000` available for Next.js

This project currently requires PostgreSQL for Prisma. If Docker is not running,
`pnpm dev:qa` exits with a clear message before running migrations or starting
the server.

## Seeded Data

`prisma/seed.qa.ts` resets and recreates deterministic QA records:

- User: `qa@vectorflow.local`
- Workspace/team: `QA Dev Workspace`
- Environment: `qa-dev`
- Pipeline: `QA Seed Pipeline`
- Canvas: one `demo_logs` source, one `blackhole` sink, and one edge
- Agent enrollment stub: an environment enrollment token plus a healthy enrolled
  node named `qa-agent-01`

Run the seed directly when the server is already stopped:

```bash
pnpm seed:qa
```

## Reset

To reset only the QA seed records, stop `pnpm dev:qa` and rerun:

```bash
pnpm seed:qa
```

To reset the entire QA database volume:

```bash
docker compose -f e2e/docker-compose.e2e.yml down -v
pnpm dev:qa
```

## Dev Auth Bypass

`DEV_AUTH_BYPASS=1` is only for local QA. It bypasses interactive NextAuth login
and returns a session for the seeded QA user.

Guardrails:

- The bypass is disabled unless `DEV_AUTH_BYPASS=1` is explicitly set.
- The bypass throws and refuses to run when `NODE_ENV=production`.
- Bypassed sessions are served only for localhost requests by default. If a
  remote devcontainer, tunnel, or shared QA host truly needs this bypass, set
  `DEV_AUTH_BYPASS_ALLOW_NETWORK=1` as a second explicit opt-in.
- `pnpm dev:qa` logs a startup warning before launching Next.js.
- The server-side auth path logs a warning the first time it serves the bypassed
  session.

## Smoke Test

With `pnpm dev:qa` running, verify the seeded pipeline canvas with:

```bash
pnpm test:e2e:qa
```

The smoke navigates to `/pipelines/qa-pipeline` and confirms the React Flow
canvas, the two seeded nodes, and the edge render.
