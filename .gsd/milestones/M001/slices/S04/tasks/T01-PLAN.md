---
estimated_steps: 5
estimated_files: 5
skills_used:
  - test
---

# T01: Set up Vitest infrastructure and write dashboard-data pure-function tests

**Slice:** S04 — Foundational Test Suite
**Milestone:** M001

## Description

This task establishes the test infrastructure from zero: install Vitest, configure path aliases, create the Prisma mock helper, and add a `test` script to `package.json`. It then proves the setup works by writing the first real test file for `computeChartMetrics` in `dashboard-data.ts` — a pure computation function that needs no mocking.

The codebase currently has no test runner, no test files, and no test-related dependencies. This task must get `pnpm test` working end-to-end.

## Steps

1. Install `vitest` and `vitest-mock-extended` as devDependencies: `pnpm add -D vitest vitest-mock-extended`
2. Create `vitest.config.ts` at project root with:
   - `@/` path alias resolving to `./src/`
   - Exclude `src/generated/**` and `node_modules` from test file discovery
   - Set `test.globals` to false (explicit imports)
3. Create `src/__mocks__/lib/prisma.ts` — a Prisma deep-mock helper:
   - Import `PrismaClient` from `@/generated/prisma`
   - Import `mockDeep`, `mockReset`, `DeepMockProxy` from `vitest-mock-extended`
   - Import `beforeEach, vi` from `vitest`
   - Call `vi.mock('@/lib/prisma', () => ({ prisma: mockDeep<PrismaClient>() }))`
   - Export the mock as `prismaMock` (typed as `DeepMockProxy<PrismaClient>`) extracted from the mocked module
   - Call `mockReset(prismaMock)` in a `beforeEach` block
4. Add `"test": "vitest run"` to the `scripts` section in `package.json`
5. Create `src/server/services/__tests__/dashboard-data.test.ts` with tests for `computeChartMetrics`:
   - Test `groupBy: "pipeline"` — two pipelines with fixture rows, verify eventsIn/eventsOut series are correctly bucketed per pipeline name
   - Test `groupBy: "node"` — two nodes, verify CPU/memory series are derived per node name
   - Test `groupBy: "aggregate"` — verify all pipeline metrics are summed into a single "Total" series
   - Test downsampling with `range: "7d"` — verify 5-minute bucket averaging
   - Test empty rows — verify empty arrays produce empty output without errors
   - Test bigint handling — use `BigInt(100)` or `100n` in fixture data, verify correct numeric conversion
   - Import `computeChartMetrics` directly (pure function, no mocking needed)

## Must-Haves

- [ ] `vitest` and `vitest-mock-extended` are in `devDependencies`
- [ ] `vitest.config.ts` exists with `@/` alias resolution
- [ ] `src/__mocks__/lib/prisma.ts` exists with `mockDeep<PrismaClient>()` pattern
- [ ] `package.json` has `"test": "vitest run"` script
- [ ] `pnpm test` runs and passes with dashboard-data tests

## Verification

- `pnpm exec vitest run --reporter=verbose` exits 0 with dashboard-data tests passing
- `test -f vitest.config.ts` — config exists
- `test -f src/__mocks__/lib/prisma.ts` — mock helper exists
- `test -f src/server/services/__tests__/dashboard-data.test.ts` — test file exists
- `grep -q '"test"' package.json` — test script exists

## Inputs

- `package.json` — add devDependencies and test script
- `src/server/services/dashboard-data.ts` — the module under test; `computeChartMetrics` function at line 97, accepts `ChartMetricsInput` with `groupBy`, `range`, `pipelineRows` (with bigint fields), `nodeRows`, `nodeNameMap`, `pipelineNameMap`, `filterOptions`
- `src/lib/prisma.ts` — the singleton pattern to mock; exports `prisma` as named export, imports `PrismaClient` from `@/generated/prisma`
- `src/generated/prisma/index.ts` — Prisma generated client (custom output path, NOT `@prisma/client`)

## Expected Output

- `vitest.config.ts` — new file, Vitest configuration with path alias
- `package.json` — modified with `vitest`, `vitest-mock-extended` in devDependencies and `test` script
- `src/__mocks__/lib/prisma.ts` — new file, Prisma deep-mock helper for all downstream test files
- `src/server/services/__tests__/dashboard-data.test.ts` — new file, first test file proving infrastructure works
