# Contributing to VectorFlow

Thank you for helping make VectorFlow better. This guide covers everything you need to get from a fresh clone to a merged pull request.

## Table of Contents

- [Development Setup](#development-setup)
- [Architecture Overview](#architecture-overview)
- [Branch Workflow](#branch-workflow)
- [Testing Requirements](#testing-requirements)
- [Code Style](#code-style)
- [Pull Request Checklist](#pull-request-checklist)
- [Issue Labels](#issue-labels)
- [Review Process](#review-process)

---

## Development Setup

### Prerequisites

| Tool | Minimum Version | Install |
|------|----------------|---------|
| Node.js | 22.x | [nodejs.org](https://nodejs.org) |
| pnpm | 9.x | `npm install -g pnpm` |
| Go | 1.22 | [go.dev](https://go.dev) |
| PostgreSQL | 15 | [postgresql.org](https://www.postgresql.org) |
| Docker (optional) | 24.x | [docker.com](https://www.docker.com) |

### 1. Clone and install

```bash
git clone https://github.com/TerrifiedBug/vectorflow.git
cd vectorflow
pnpm install
```

> Always use `pnpm`. The repo uses a `pnpm-lock.yaml` — running `npm install` or `yarn` will create a conflicting lockfile.

### 2. Database

```bash
# Create a local database
createdb vectorflow

# Apply migrations and generate the Prisma client
npx prisma migrate dev
npx prisma generate
```

### 3. Environment variables

Copy the example env file and fill in the required values:

```bash
cp .env.example .env
```

Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | ✅ | Random 32-byte secret for JWT signing |
| `NEXTAUTH_URL` | ✅ | `http://localhost:3000` for local dev |
| `ENCRYPTION_KEY` | ✅ | 32-byte hex key for at-rest secret encryption |
| `OIDC_CLIENT_ID` | ☐ | OIDC provider client ID (optional) |
| `OIDC_CLIENT_SECRET` | ☐ | OIDC provider client secret (optional) |

### 4. Start the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The first run prompts you to create an admin account.

### 5. Build the agent (optional)

```bash
cd agent
make build          # current platform
make build-all      # linux/amd64 + linux/arm64
```

---

## Architecture Overview

VectorFlow is a monorepo with two main components:

```
vectorflow/
├── src/                     # Next.js 15 server (App Router + tRPC API)
│   ├── app/                 # Pages and API routes
│   ├── components/          # React components (flow editor, forms, UI)
│   ├── server/              # tRPC routers and business logic services
│   ├── stores/              # Zustand client state
│   └── lib/                 # Shared utilities, Vector component catalog
├── agent/                   # Go binary — polls server, manages Vector processes
│   └── internal/            # poller, supervisor, metrics, log buffer
├── prisma/                  # Database schema and migrations
├── e2e/                     # Playwright end-to-end tests
└── docs/public/             # GitBook documentation (auto-synced)
```

**Key concepts:**

- **Pipelines** are drag-and-drop graphs of Vector [sources → transforms → sinks]. The editor lives in `src/components/flow/`.
- **Fleet** is the set of `vf-agent` binaries deployed on your hosts. Agents poll the server for config changes and reload [Vector](https://vector.dev) processes.
- **tRPC** handles all data mutations. There are no Next.js Server Actions for data. Routers are in `src/server/routers/`.
- **Auth** uses NextAuth 5 with credentials (bcrypt + optional TOTP) and OIDC. All secrets are AES-256-GCM encrypted at rest.

See [docs/public/](./docs/public/) for the full user-facing documentation.

---

## Branch Workflow

### Naming

```
<type>/<short-description>

feat/log-streaming
fix/pipeline-crash
test/supervisor-unit-tests
docs/api-reference
chore/update-dependencies
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

### Workflow

```bash
# Branch from main
git checkout main && git pull
git checkout -b feat/my-feature

# ... make changes ...

git add <files>
git commit -m "feat: describe what and why"
git push -u origin feat/my-feature
gh pr create
```

- **Never push directly to `main`** — branch protection enforces this.
- Each PR should address a single concern.
- Keep branches short-lived. Merge often.

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short description (imperative, lower-case)>

<optional body — explain why, not what>
```

Examples:
- `feat: add pipeline export as JSON`
- `fix: prevent double-deploy when clicking rapidly`
- `test: add unit tests for crypto service`
- `docs: add fleet deployment guide`

---

## Testing Requirements

**Minimum: 80% coverage.** All PRs must pass lint, type-check, and test gates.

### Running tests

```bash
pnpm test                          # run all unit tests (vitest)
npx vitest src/path/to/file.test.ts  # run a single test file
pnpm lint                          # ESLint
npx tsc --noEmit                   # TypeScript type check
cd agent && go test ./...           # Go unit tests
```

### What to test

| Layer | What | Framework |
|-------|------|-----------|
| tRPC routers | Authorization, input validation, return shape | Vitest + `vitest-mock-extended` |
| Services | Business logic, error paths, crypto | Vitest |
| React components | Interaction, state changes, rendering | Vitest + Testing Library |
| Flow store | Undo/redo, clipboard, selection | Vitest |
| Agent (Go) | Supervisor state machine, poller retry | `go test` |
| E2E | Critical user flows (auth, pipeline CRUD, deploy) | Playwright |

### Test conventions

- **No globals** — import `describe`, `it`, `expect` from `vitest` explicitly.
- Tests live alongside source: `src/server/routers/pipeline.ts` → `src/server/routers/pipeline.test.ts`
- Mock Prisma with `mockDeep<PrismaClient>()` from `vitest-mock-extended`.
- Do not mock the database in integration tests — use real migrations on a test DB.
- E2E specs live in `e2e/tests/` and follow the page-object pattern in `e2e/pages/`.

### Test-driven development

Prefer writing the test first:

1. Write a failing test (Red)
2. Write the minimal implementation (Green)
3. Refactor (Improve)
4. Confirm coverage with `pnpm test --coverage`

---

## Code Style

### TypeScript / JavaScript

- **ESLint** with `next/core-web-vitals` + `typescript` rules. Run `pnpm lint` before pushing.
- **No mutation** — return new objects instead of mutating existing ones.
- **Functions under 50 lines.** Extract helpers if longer.
- **Files under 800 lines.** Prefer many small, focused files.
- **Immutable patterns** — use `const`, spread operators, and functional transforms.
- Organize by feature/domain, not by type (avoid `utils/`, `helpers/` catch-alls).

### Go

- Format with `gofmt` (enforced by CI).
- Follow standard Go error-handling idioms: return errors, don't panic.
- Vet with `go vet ./...` before committing.
- Concurrent code requires race-detector testing: `go test -race ./...`.

### Path aliases

Use `@/*` for imports under `src/`:

```ts
import { db } from '@/lib/prisma'    // ✅
import { db } from '../../lib/prisma' // ✗
```

---

## Pull Request Checklist

Before opening a PR:

- [ ] All tests pass locally (`pnpm test`, `go test ./...`)
- [ ] No type errors (`npx tsc --noEmit`)
- [ ] No lint warnings (`pnpm lint`)
- [ ] Coverage did not drop below 80%
- [ ] New features have tests
- [ ] Bug fixes include a regression test
- [ ] No hardcoded secrets or credentials
- [ ] PR description explains the *why*, not just the *what*
- [ ] Screenshots or recordings attached for UI changes
- [ ] Public-facing changes have corresponding `docs/public/` updates

---

## Issue Labels

| Label | Meaning |
|-------|---------|
| `bug` | Something is broken or behaves unexpectedly |
| `enhancement` | New feature or improvement to existing behaviour |
| `documentation` | Docs-only change |
| `ci` | Changes to GitHub Actions or build tooling |
| `agent` | Affects the Go `vf-agent` binary |
| `dependencies` | Dependency update (npm, Go modules) |
| `docker` | Docker or container-related changes |
| `good first issue` | Suitable for new contributors |
| `help wanted` | Extra attention or expertise needed |

To pick up work, comment on the issue or open a draft PR and link it. Assign yourself so others know it's taken.

---

## Review Process

### Who reviews

All PRs require at least one maintainer approval before merge. For significant changes (new features, architectural refactors, security-sensitive code), two reviewers are preferred.

### What reviewers look for

1. **Correctness** — does it do what it says?
2. **Tests** — are the tests meaningful and sufficient?
3. **Security** — no secrets, proper input validation, no injection vectors
4. **Simplicity** — is this the simplest solution that works?
5. **Docs** — is user-facing behaviour documented?

### SLA

Maintainers aim to leave an initial review comment within **3 business days**. If you haven't heard back after 5 days, ping the thread.

### After approval

Squash-merge is preferred for feature branches. The PR author merges after approval.
