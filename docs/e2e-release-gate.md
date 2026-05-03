# E2E Release Gate

The Playwright gate uses Docker-backed PostgreSQL, Prisma migrations, and the
same Prisma 7 PostgreSQL adapter pattern as the application runtime.

## Prerequisites

- Node.js 22+ and pnpm 10+
- Docker daemon access with Docker Compose v2
- Port `5433` available for the e2e PostgreSQL container
- Port `3000` available for the Next.js server

## Environment

```bash
export DATABASE_URL='postgresql://vectorflow_e2e:e2e_test_password@127.0.0.1:5433/vectorflow_e2e?schema=public'
export NEXTAUTH_SECRET='e2e-nextauth-secret-at-least-16'
export NEXTAUTH_URL='http://localhost:3000'
export NODE_ENV='test'
```

## Command Sequence

Run these commands from the repository root:

```bash
pnpm install --frozen-lockfile
docker compose -f e2e/docker-compose.e2e.yml up -d --wait
pnpm exec prisma migrate deploy
pnpm exec next dev -p 3000
```

In a second shell with the same environment variables:

```bash
pnpm exec playwright test --project=setup
pnpm exec playwright test \
  e2e/tests/auth.spec.ts \
  e2e/tests/pipeline-crud.spec.ts \
  e2e/tests/deploy.spec.ts \
  e2e/tests/fleet.spec.ts \
  --project=chromium
```

The `setup` project seeds the e2e user/team/environment/pipeline/fleet data and
writes `e2e/.auth/user.json`. The second command exercises browser
authentication, the first pipeline workflow, deploy flow, and fleet health using
that stored authentication state.

## Teardown

```bash
docker compose -f e2e/docker-compose.e2e.yml down -v
```
