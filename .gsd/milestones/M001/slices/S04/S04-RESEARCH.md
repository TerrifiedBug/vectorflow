# S04: Foundational Test Suite — Research

**Date:** 2026-03-23
**Depth:** Targeted — known technology (Vitest), new to this codebase, moderate complexity around Prisma 7 mocking strategy

## Summary

The codebase has zero test infrastructure — no test runner, no test files, no test dependencies. S04 needs to set up Vitest from scratch and write foundational tests covering four domains specified in R002: auth flows, pipeline CRUD, deploy operations, and alert evaluation.

The critical insight from code exploration is that the S02 service extraction created highly testable units. `dashboard-data.ts` is fully pure (no Prisma imports, no side effects), `pipeline-graph.ts` has clearly typed interfaces, and `alert-evaluator.ts` has private helpers (`checkCondition`, `buildMessage`) that encode important business logic. The recommended approach is a **layered testing strategy**: start with pure-function unit tests (zero mocking needed), then add Prisma-mocked tests for DB-dependent services using `vitest-mock-extended` to deep-mock the singleton `prisma` import.

Auth testing should focus on the credential provider logic and TOTP verification (which are pure functions testable without NextAuth), not on mocking the full NextAuth flow. The TOTP module (`src/server/services/totp.ts`) is entirely pure and has no Prisma dependencies — ideal for testing.

## Recommendation

**Approach: Vitest + vitest-mock-extended with vi.mock for Prisma singleton**

1. **Install** `vitest` and `vitest-mock-extended` as devDependencies
2. **Create** `vitest.config.ts` at project root with `@/` path alias resolution
3. **Create** `src/__mocks__/lib/prisma.ts` that exports a deep-mocked PrismaClient
4. **Write tests in 4 task-sized batches** organized by R002's four domains, prioritized by testability (pure functions first, Prisma-dependent last)

Use `vi.mock('@/lib/prisma')` with `vitest-mock-extended`'s `mockDeep<PrismaClient>()` to intercept the singleton import. This is the Prisma-recommended approach and matches the project's singleton pattern (`src/lib/prisma.ts` exports `prisma` as a named export).

Do NOT use `prisma-mock-vitest` or `prismock` — they add complexity with in-memory DB simulation that isn't needed for unit tests, and their Prisma 7 compatibility is uncertain. Simple deep mocking with `mockResolvedValue` is sufficient and gives full control over test scenarios.

## Implementation Landscape

### Key Files

**Test infrastructure (new):**
- `vitest.config.ts` — Vitest config with `@/` alias, exclude patterns for generated code
- `src/__mocks__/lib/prisma.ts` — Prisma deep mock singleton, reset in `beforeEach`

**Test targets (pure functions — no mocking needed):**
- `src/server/services/dashboard-data.ts` — `computeChartMetrics()` (pure computation: time-series bucketing, downsampling, aggregation), `assembleNodeCards()`, `assemblePipelineCards()` — all accept plain typed inputs, return data
- `src/server/services/totp.ts` — `generateTotpSecret()`, `verifyTotpCode()`, `generateBackupCodes()`, `hashBackupCode()`, `verifyBackupCode()` — all pure, no Prisma
- `src/lib/pipeline-status.ts` — `aggregateProcessStatus()`, `derivePipelineStatus()` — shared utilities extracted in S01

**Test targets (Prisma-dependent — need mocking):**
- `src/server/services/alert-evaluator.ts` — `evaluateAlerts()` — 12 Prisma calls, in-memory `conditionFirstSeen` map for duration tracking, private helpers `checkCondition`, `readMetricValue`, `buildMessage`
- `src/server/services/pipeline-graph.ts` — `saveGraphComponents()`, `promotePipeline()`, `discardPipelineChanges()`, `detectConfigChanges()`, `listPipelinesForEnvironment()` — 15 TRPCError throw sites, `Tx` parameter pattern for transaction-scoped work
- `src/server/services/deploy-agent.ts` — `deployAgent()`, `undeployAgent()` — depends on `prisma`, `validateConfig` (Vector CLI), `createVersion`, `gitSyncCommitPipeline`, `pushRegistry`

**Auth test targets (mixed):**
- `src/server/services/totp.ts` — pure (covered above)
- `src/server/services/crypto.ts` — `encrypt()`, `decrypt()` — needs `NEXTAUTH_SECRET` env var, otherwise pure
- `src/auth.ts` — `credentialsProvider.authorize()` logic — deeply coupled to Prisma + bcrypt + NextAuth. Test the underlying TOTP/crypto modules directly rather than trying to mock the full NextAuth authorize flow.

**Configuration files to modify:**
- `package.json` — add `test` script and devDependencies
- `tsconfig.json` — no changes needed (already has `@/*` path alias)

### Build Order

**T01: Test infrastructure setup + first pure tests (dashboard-data)**
- Install `vitest`, `vitest-mock-extended`
- Create `vitest.config.ts` with path alias (`@/ → ./src/`)
- Create Prisma mock helper at `src/__mocks__/lib/prisma.ts`
- Add `"test": "vitest run"` to `package.json` scripts
- Write `src/server/services/__tests__/dashboard-data.test.ts` — test `computeChartMetrics` with fixture data for all 3 `groupBy` modes (pipeline, node, aggregate), downsampling, and edge cases (empty rows, bigint handling). This proves the test infrastructure works.
- **Why first:** Zero mocking needed. If vitest + path aliases work for this, all downstream tests will work. Unblocks everything.

**T02: Auth & utility pure-function tests (totp, crypto, pipeline-status)**
- Write `src/server/services/__tests__/totp.test.ts` — test TOTP generation, verification (valid/expired/wrong code), backup code generation, hashing, and verification (consume-on-use)
- Write `src/server/services/__tests__/crypto.test.ts` — test encrypt/decrypt round-trip, wrong-key failure (set `NEXTAUTH_SECRET` in test env)
- Write `src/lib/__tests__/pipeline-status.test.ts` — test `aggregateProcessStatus` and `derivePipelineStatus` with various inputs
- **Why second:** All pure functions, builds confidence in test patterns before adding mocking complexity.

**T03: Alert evaluation tests (Prisma mocking)**
- Write `src/server/services/__tests__/alert-evaluator.test.ts` — mock `@/lib/prisma` using the deep mock helper
- Test `evaluateAlerts` with mocked DB responses for: rule fires when condition met beyond duration, rule resolves when condition clears, binary metrics (node_unreachable, pipeline_crashed), percentage metrics (cpu_usage, memory_usage), skip event-based rules, deduplication (existing firing event prevents duplicate)
- **Why third:** First test that uses Prisma mocking — proves the mock pattern works. Alert evaluation is the most self-contained DB-dependent service (single exported function).

**T04: Pipeline service tests (Prisma mocking + TRPCError)**
- Write `src/server/services/__tests__/pipeline-graph.test.ts` — test `detectConfigChanges` (pure after mocking `generateVectorYaml`), `saveGraphComponents` error paths (pipeline not found, duplicate component keys, invalid shared component references), `listPipelinesForEnvironment`
- Write `src/server/services/__tests__/deploy-agent.test.ts` — test `deployAgent` error paths (pipeline not found, validation failure), mock the `validateConfig`, `createVersion`, and other service dependencies
- **Why last:** Most complex mocking (nested service dependencies, Tx parameter). Benefits from patterns established in T03.

### Verification Approach

```bash
# T01: Infrastructure works, first tests pass
pnpm exec vitest run --reporter=verbose 2>&1 | head -30

# After all tasks:
pnpm exec vitest run                  # All tests pass
pnpm exec tsc --noEmit                # No type errors introduced
pnpm exec eslint src/                 # No lint errors introduced

# Coverage summary (informational, not a gate):
pnpm exec vitest run --coverage 2>&1 | tail -20
```

**Test file count target:** 6-7 test files across 4 tasks, covering all 4 domains in R002.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Deep mocking Prisma Client | `vitest-mock-extended` (`mockDeep<PrismaClient>()`) | Type-safe deep mock with `mockResolvedValue` on any nested method. Prisma-recommended pattern. |
| Path alias resolution | `vite-tsconfig-paths` or manual `alias` in vitest config | Resolves `@/` imports matching tsconfig `paths` so test imports work |
| TOTP verification in tests | `otpauth` (already installed) | Generate valid TOTP codes in tests using the same library the app uses |

## Constraints

- **Prisma 7.4.2 with `@prisma/adapter-pg`**: The generated client lives at `src/generated/prisma/` (not `@prisma/client`). The mock must target this custom output path — `import { PrismaClient } from '@/generated/prisma'`.
- **`src/lib/prisma.ts` uses named export** (`export const prisma`), not default export. The `vi.mock` factory must return `{ prisma: mockDeep<PrismaClient>() }`.
- **`crypto.ts` needs `NEXTAUTH_SECRET`**: Set via `process.env.NEXTAUTH_SECRET = 'test-secret'` in a test setup file or inline.
- **`alert-evaluator.ts` has module-level state**: `conditionFirstSeen` Map persists between calls. Tests must account for this — either test duration tracking across sequential calls, or accept that each test file gets a fresh module scope (Vitest default).
- **No `server-only` imports** in `src/server/` — no need to mock Next.js server-only module.
- **`tsc --noEmit` and `eslint src/` must remain passing** (R001, R008). Test files must be excluded from eslint config or pass lint.

## Common Pitfalls

- **`vitest-mock-extended` version compatibility** — Ensure the version installed is compatible with Vitest 3.x (current). Use `vitest-mock-extended@^2.0.0` which is the latest stable.
- **Mock hoisting with `vi.mock`** — Calls to `vi.mock()` are hoisted to the top of the file. Variables referenced inside `vi.mock()` factories must be declared with `vi.hoisted()` or be static imports. Don't try to reference `beforeEach`-scoped variables inside the factory.
- **BigInt in test fixtures** — `dashboard-data.ts` uses `bigint` fields (e.g., `eventsIn: bigint`). Test fixtures must use `BigInt(100)` or `100n` syntax. TypeScript's `bigint` type can cause issues if vitest's serialization doesn't handle it — use `.toEqual()` not `.toBe()` for objects containing BigInts.
- **`detectConfigChanges` calls `generateVectorYaml`** — This is an imported function, not a Prisma call. Mock it separately with `vi.mock('@/lib/config-generator')` to avoid pulling in the full YAML generation dependency tree.
- **Eslint on test files** — The project uses `eslint-config-next`. Test files should be in the eslint include path but may need `@typescript-eslint` relaxations for mocking patterns. If eslint fails on test files, exclude `**/*.test.ts` in eslint config.

## Open Risks

- **`vitest-mock-extended` may not fully support Prisma 7's new client API** — Prisma 7 changed the client internals significantly (driver adapters, new generator output). `mockDeep<PrismaClient>()` should still work since it mocks at the interface level, but if `PrismaClient` shape from `@/generated/prisma` has breaking differences, the mock may need adjustments. Mitigated by T01 proving the pattern works before committing to it across all tests.
- **eslint may flag test patterns** — Test files use `vi.mock()`, `vi.hoisted()`, and `mockDeep` which may trigger unfamiliar lint rules. Low risk — exclude test files from eslint or add overrides.

## Sources

- Prisma unit testing docs: vi.mock with singleton pattern using `mockDeep<PrismaClient>()` + `mockReset` in `beforeEach` (source: [Prisma Unit Testing](https://www.prisma.io/docs/orm/prisma-client/testing/unit-testing))
- Vitest module mocking: `vi.mock(import('./path'))` with async factory for partial mocking, `vi.hoisted()` for variable references (source: [Vitest API - vi.mock](https://vitest.dev/api/vi))
- Vitest path alias config: use `vite-tsconfig-paths` plugin or manual `alias` in vitest.config.ts (source: [Vitest Common Errors](https://vitest.dev/guide/common-errors))
