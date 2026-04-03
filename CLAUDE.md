# VectorFlow

## Git Workflow (CRITICAL)

**Never push directly to `main`.** All changes must go through pull requests.

### Branch Naming

Use the pattern: `<type>/<short-description>`

Examples:
- `feat/log-streaming-live-tap`
- `fix/pipeline-deploy-crash`
- `test/router-unit-tests`
- `chore/update-dependencies`

Types: `feat`, `fix`, `test`, `chore`, `refactor`, `docs`, `perf`, `ci`

### Workflow

1. **Create a feature branch** from `main` before making any changes
2. **Make commits** on your feature branch (not `main`)
3. **Push your branch** and open a PR against `main`
4. **Request review** — the Tester or a team member must approve before merge
5. **Never force-push to `main`** — branch protection is enforced

### Worktree Isolation

When working on a task, prefer using git worktrees to avoid conflicts with other agents:

```bash
git worktree add ../worktree-<branch-name> -b <branch-name>
```

Clean up worktrees when done:

```bash
git worktree remove ../worktree-<branch-name>
```

### Commit Messages

```
<type>: <description>
```

## Tech Stack

- **Frontend**: Next.js, React, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: tRPC routers, Prisma ORM, PostgreSQL
- **Agent**: Go (`agent/` directory) — vf-agent with Vector process supervision
- **Testing**: Vitest (unit/integration), Playwright (E2E)
- **Package Manager**: pnpm

## Project Structure

```
src/
  app/          # Next.js app router pages
  components/   # React components (shadcn/ui based)
  server/       # tRPC routers, services, database
  lib/          # Shared utilities
  trpc/         # tRPC client setup
  hooks/        # React hooks
  stores/       # State management
  types/        # TypeScript type definitions
agent/          # Go agent (vf-agent)
prisma/         # Database schema and migrations
e2e/            # Playwright E2E tests
docker/         # Docker configurations
```

## Development Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Start dev server
pnpm build            # Production build
pnpm test             # Run Vitest tests
pnpm lint             # Run ESLint
pnpm db:push          # Push Prisma schema to DB
pnpm db:generate      # Generate Prisma client
```

## Testing

- Unit tests live alongside source in `src/__tests__/` or `*.test.ts` files
- E2E tests in `e2e/` directory using Playwright
- Target: 80%+ code coverage
- Always run `pnpm test` before opening a PR
