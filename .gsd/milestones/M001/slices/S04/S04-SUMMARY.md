# S04: Foundational Test Suite — Summary

**Status:** Complete
**Tests:** 105 passing across 7 test files
**Duration:** ~53 minutes across 4 tasks
**Domains covered:** Auth (TOTP, crypto), Pipeline CRUD (graph, dashboard data), Deploy, Alert Evaluation, Pipeline Utilities

## What This Slice Delivered

Test infrastructure from zero and a foundational test suite covering all four R002 domains. The codebase went from zero tests to 105 passing unit tests validating core business logic.

### Infrastructure (T01)
- Vitest 4.1.0 + vitest-mock-extended 3.1.0 installed as devDependencies
- `vitest.config.ts` with `@/` → `./src/` path alias matching tsconfig
- `pnpm test` script runs full suite; exits non-zero on failure (CI-ready)
- Prisma deep-mock documentation helper at `src/__mocks__/lib/prisma.ts`

### Test Coverage by Domain

| Domain | File | Tests | Type |
|--------|------|-------|------|
| Pipeline (dashboard) | `dashboard-data.test.ts` | 15 | Pure function |
| Auth (TOTP) | `totp.test.ts` | 25 | Pure function |
| Auth (crypto) | `crypto.test.ts` | 13 | Pure function + env |
| Pipeline utilities | `pipeline-status.test.ts` | 19 | Pure function |
| Alert evaluation | `alert-evaluator.test.ts` | 12 | Prisma-mocked |
| Pipeline CRUD | `pipeline-graph.test.ts` | 13 | Prisma-mocked |
| Deploy operations | `deploy-agent.test.ts` | 8 | Prisma-mocked |

### What's Tested
- **Auth:** TOTP secret generation, code verification (valid/invalid/expired), backup code generation/hashing/verification/consumption, case-insensitive matching, encrypt/decrypt round-trip (AES-256-GCM), randomization, error handling, missing-secret errors
- **Pipeline CRUD:** computeChartMetrics (3 groupBy modes, downsampling, bigint, latency), detectConfigChanges (6 scenarios), saveGraphComponents error paths (NOT_FOUND, BAD_REQUEST), listPipelinesForEnvironment (stale components, draft behavior)
- **Deploy:** deployAgent (pipeline-not-found, validation failure, success, prebuilt YAML, system vector, push notifications), undeployAgent (not-found, success)
- **Alerts:** Condition firing/resolving, deduplication, binary metrics (node_unreachable, pipeline_crashed), null metrics, duration tracking with fake timers, event-based rule skipping
- **Utilities:** aggregateProcessStatus (priority ordering, empty arrays), derivePipelineStatus (all status combinations)

## Patterns Established

### Prisma Mock Pattern (D006)
Inline `vi.mock` factory, not the shared `__mocks__` helper:
```ts
vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
import { prisma } from "@/lib/prisma";
const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
```
Call `mockReset(prismaMock)` in `beforeEach`. This pattern is proven across 3 test files.

### Multi-Module Mocking
For services with many dependencies (deploy-agent mocks 8 modules), each module gets its own `vi.mock` factory call. The `pushRegistry` singleton uses `{ pushRegistry: { send: vi.fn() } }`.

### Tx Parameter Mocking
Pass `prismaMock as unknown as Tx` — the DeepMockProxy satisfies Prisma.TransactionClient for transaction-scoped functions.

### Environment Variable Isolation
Crypto tests save/restore `process.env.NEXTAUTH_SECRET` in `beforeAll`/`afterAll` with `try/finally` for per-test mutations.

### BigInt in Tests
Use `BigInt(0)` constructor — not `0n` literals. The project targets ES2017 which doesn't support bigint literals, and `tsc --noEmit` will reject them even though Vitest's transpiler handles them at runtime.

## Verification Results

| Check | Result |
|-------|--------|
| `pnpm exec vitest run --reporter=verbose` | ✅ 105/105 pass (0.5s) |
| `pnpm exec tsc --noEmit` | ✅ exit 0 |
| `pnpm exec eslint src/` | ✅ exit 0 |
| 7 test files exist | ✅ all present |
| Test files ≥ 6 | ✅ 7 files |
| R001 preserved | ✅ tsc clean |
| R008 preserved | ✅ eslint clean |

## What the Next Slice Should Know

- **Test runner is ready:** `pnpm test` runs the full suite. New test files in `__tests__/` dirs are auto-discovered.
- **Prisma mocking works:** Use the inline `vi.mock` pattern from D006. Do NOT use the `src/__mocks__/lib/prisma.ts` file directly — it's documentation only.
- **Service testability confirmed:** S02's service extraction (D004) directly enabled S04 tests. Services accept plain parameters, no tRPC context needed.
- **No runtime changes:** S04 is test infrastructure only. No production code was modified.
- **CI integration:** `pnpm test` exits non-zero on any failure. Ready for CI gating.

## Requirements Updated
- **R002** → validated (105 tests across all four domains)
- **R007** → validated (service extraction proven testable via 36 service tests)

## Upstream Dependencies Consumed
- `src/lib/pipeline-status.ts` (S01) — tested with 19 pure function tests
- `src/server/services/pipeline-graph.ts` (S02) — tested with 13 Prisma-mocked tests
- `src/server/services/dashboard-data.ts` (S02) — tested with 15 pure function tests
- `src/server/services/deploy-agent.ts` (S02) — tested with 8 Prisma-mocked tests
