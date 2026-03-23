# S04: Foundational Test Suite

**Goal:** Test infrastructure is set up with Vitest, and foundational tests pass for all four R002 domains: auth flows, pipeline CRUD, deploy operations, and alert evaluation.
**Demo:** `pnpm exec vitest run` passes with 6+ test files covering pure-function and Prisma-mocked service tests across all four domains.

## Must-Haves

- Vitest installed and configured with `@/` path alias resolution
- Prisma deep-mock helper created for `@/lib/prisma` singleton pattern
- `pnpm test` script in `package.json` runs all tests
- Test coverage for `computeChartMetrics` (dashboard-data, pipeline domain)
- Test coverage for `generateTotpSecret`, `verifyTotpCode`, `generateBackupCodes`, `hashBackupCode`, `verifyBackupCode` (auth domain)
- Test coverage for `encrypt`/`decrypt` round-trip (auth domain)
- Test coverage for `aggregateProcessStatus`, `derivePipelineStatus` (pipeline utilities)
- Test coverage for `evaluateAlerts` including condition checking, duration tracking, firing, resolving (alert domain)
- Test coverage for `saveGraphComponents` and `detectConfigChanges` error paths (pipeline CRUD domain)
- Test coverage for `deployAgent` error paths (deploy domain)
- `tsc --noEmit` exits 0 (R001 preserved)
- `eslint src/` exits 0 (R008 preserved)

## Proof Level

- This slice proves: contract (service function behavior against typed inputs/outputs)
- Real runtime required: no (unit tests with mocked dependencies)
- Human/UAT required: no

## Verification

- `pnpm exec vitest run --reporter=verbose` — all tests pass, 6+ test files
- `pnpm exec tsc --noEmit` — exits 0, no regressions (R001)
- `pnpm exec eslint src/` — exits 0, no regressions (R008)
- Test files exist: `src/server/services/__tests__/dashboard-data.test.ts`, `src/server/services/__tests__/totp.test.ts`, `src/server/services/__tests__/crypto.test.ts`, `src/lib/__tests__/pipeline-status.test.ts`, `src/server/services/__tests__/alert-evaluator.test.ts`, `src/server/services/__tests__/pipeline-graph.test.ts`, `src/server/services/__tests__/deploy-agent.test.ts`

## Integration Closure

- Upstream surfaces consumed: Service modules from S01 (`src/lib/pipeline-status.ts`) and S02 (`src/server/services/pipeline-graph.ts`, `src/server/services/dashboard-data.ts`, `src/server/services/deploy-agent.ts`)
- New wiring introduced in this slice: `vitest.config.ts`, `package.json` test script, Prisma mock helper — test infrastructure only, no runtime changes
- What remains before the milestone is truly usable end-to-end: S05 (performance audit)

## Observability / Diagnostics

- **Test output**: `pnpm exec vitest run --reporter=verbose` shows per-test pass/fail with durations — primary inspection surface for test health
- **Failure visibility**: Vitest outputs assertion diffs with expected/received values and source locations on any test failure
- **CI integration**: `pnpm test` exits non-zero on any test failure, suitable for CI gating
- **Mock state**: `prismaMock` resets via `beforeEach` in the mock helper — stale mock state from one test cannot leak to another
- **Redaction**: No secrets or PII in test fixtures; all data is synthetic

## Tasks

- [x] **T01: Set up Vitest infrastructure and write dashboard-data pure-function tests** `est:45m`
  - Why: Establishes test infrastructure from zero — vitest config, path aliases, Prisma mock helper, `test` script — and proves it works with the first real test file targeting `computeChartMetrics` (pure computation, no mocking needed).
  - Files: `vitest.config.ts`, `package.json`, `src/__mocks__/lib/prisma.ts`, `src/server/services/__tests__/dashboard-data.test.ts`
  - Do: Install `vitest` and `vitest-mock-extended` as devDependencies. Create `vitest.config.ts` with `@/` → `./src/` alias. Create Prisma deep-mock helper. Add `"test": "vitest run"` script. Write tests for `computeChartMetrics` covering all 3 `groupBy` modes, downsampling (7d range), empty rows, and bigint handling. Use `BigInt()` or `100n` syntax in fixtures.
  - Verify: `pnpm exec vitest run --reporter=verbose` passes with dashboard-data tests green
  - Done when: `pnpm test` exits 0 and `src/server/services/__tests__/dashboard-data.test.ts` exists with passing tests

- [x] **T02: Write auth and utility pure-function tests (totp, crypto, pipeline-status)** `est:30m`
  - Why: Covers the auth domain (R002) with TOTP and crypto tests, plus shared utility coverage. All pure functions — builds test confidence before Prisma mocking.
  - Files: `src/server/services/__tests__/totp.test.ts`, `src/server/services/__tests__/crypto.test.ts`, `src/lib/__tests__/pipeline-status.test.ts`
  - Do: Test TOTP generation/verification (valid, expired, wrong code), backup codes (generate, hash, verify, consume-on-use). Test encrypt/decrypt round-trip (set `NEXTAUTH_SECRET` env var in test). Test `aggregateProcessStatus` and `derivePipelineStatus` with various inputs including edge cases (empty array, all same status).
  - Verify: `pnpm exec vitest run --reporter=verbose` passes with all 4 test files green (3 new + 1 from T01)
  - Done when: All 3 new test files exist and pass

- [x] **T03: Write alert-evaluator tests with Prisma mocking** `est:45m`
  - Why: First Prisma-mocked test — proves the `vi.mock('@/lib/prisma')` pattern works with `vitest-mock-extended`. Covers the alert evaluation domain (R002). Alert evaluator has rich business logic: condition checking, duration tracking via in-memory map, firing/resolving events, deduplication.
  - Files: `src/server/services/__tests__/alert-evaluator.test.ts`
  - Do: Mock `@/lib/prisma` using the deep-mock helper. Test: condition fires when threshold exceeded beyond duration, condition resolves when value drops, binary metrics (node_unreachable, pipeline_crashed), percentage metrics (cpu_usage), skip event-based rules (no condition/threshold), deduplication (existing firing event prevents duplicate), duration tracking across sequential calls. Use `vi.hoisted()` for mock variable if needed. Account for module-level `conditionFirstSeen` Map state.
  - Verify: `pnpm exec vitest run --reporter=verbose` passes with alert-evaluator tests green
  - Done when: `src/server/services/__tests__/alert-evaluator.test.ts` exists and passes

- [x] **T04: Write pipeline-graph and deploy-agent tests with Prisma mocking** `est:45m`
  - Why: Covers pipeline CRUD and deploy domains (R002). These are the most complex mocking targets with nested service dependencies, `Tx` parameter, and TRPCError throw sites. Benefits from mocking patterns proven in T03.
  - Files: `src/server/services/__tests__/pipeline-graph.test.ts`, `src/server/services/__tests__/deploy-agent.test.ts`
  - Do: For pipeline-graph: mock `@/lib/prisma` and `@/lib/config-generator` (`generateVectorYaml`). Test `detectConfigChanges` (pure after mocking YAML generation), `saveGraphComponents` error paths (pipeline not found, duplicate component keys), `listPipelinesForEnvironment`. For deploy-agent: mock prisma and service dependencies (`validateConfig`, `createVersion`, `gitSyncCommitPipeline`, `pushRegistry`). Test `deployAgent` error paths (pipeline not found, validation failure). Ensure `tsc --noEmit` and `eslint src/` still pass after all test files are written.
  - Verify: `pnpm exec vitest run --reporter=verbose` passes all 7 test files; `pnpm exec tsc --noEmit` exits 0; `pnpm exec eslint src/` exits 0
  - Done when: All 7 test files exist and pass, R001 and R008 hold

## Files Likely Touched

- `vitest.config.ts` (new)
- `package.json` (modified — devDependencies, scripts)
- `src/__mocks__/lib/prisma.ts` (new)
- `src/server/services/__tests__/dashboard-data.test.ts` (new)
- `src/server/services/__tests__/totp.test.ts` (new)
- `src/server/services/__tests__/crypto.test.ts` (new)
- `src/lib/__tests__/pipeline-status.test.ts` (new)
- `src/server/services/__tests__/alert-evaluator.test.ts` (new)
- `src/server/services/__tests__/pipeline-graph.test.ts` (new)
- `src/server/services/__tests__/deploy-agent.test.ts` (new)
- `eslint.config.mjs` (possibly modified — if test files need eslint overrides)
