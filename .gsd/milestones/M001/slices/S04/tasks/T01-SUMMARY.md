---
id: T01
parent: S04
milestone: M001
provides:
  - Vitest test infrastructure (config, path aliases, Prisma mock helper, test script)
  - 15 passing tests for computeChartMetrics pure function
key_files:
  - vitest.config.ts
  - package.json
  - src/__mocks__/lib/prisma.ts
  - src/server/services/__tests__/dashboard-data.test.ts
key_decisions:
  - Use BigInt() constructor instead of bigint literals (0n) in tests because tsconfig targets ES2017
patterns_established:
  - Prisma deep-mock helper pattern at src/__mocks__/lib/prisma.ts for downstream test files
  - Test fixture helper functions (makePipelineRow, makeNodeRow) for consistent test data
observability_surfaces:
  - pnpm exec vitest run --reporter=verbose — shows per-test pass/fail with durations
duration: 12m
verification_result: passed
completed_at: 2026-03-23
blocker_discovered: false
---

# T01: Set up Vitest infrastructure and write dashboard-data pure-function tests

**Installed Vitest with path alias config, created Prisma deep-mock helper, and added 15 passing tests for computeChartMetrics covering all groupBy modes, downsampling, empty input, bigint handling, and latency**

## What Happened

Installed `vitest` (4.1.0) and `vitest-mock-extended` (3.1.0) as devDependencies. Created `vitest.config.ts` with `@/` → `./src/` path alias resolution matching the project's tsconfig paths, excluded `src/generated/**` from test discovery, and set `test.globals` to false for explicit imports.

Created the Prisma deep-mock helper at `src/__mocks__/lib/prisma.ts` using `mockDeep<PrismaClient>()` from vitest-mock-extended, with `vi.mock('@/lib/prisma')` to intercept the singleton and `beforeEach` reset. This helper will be reused by all downstream Prisma-mocking tests in T03 and T04.

Added `"test": "vitest run"` to `package.json` scripts.

Wrote `src/server/services/__tests__/dashboard-data.test.ts` with 15 tests for `computeChartMetrics`:
- `groupBy: "pipeline"` — verifies eventsIn/eventsOut bucketed per pipeline name with /60 rate conversion, and fallback to raw pipelineId when name map is empty
- `groupBy: "node"` — verifies pipeline metrics are summed per node, and CPU/memory series are derived from delta calculations on node rows
- `groupBy: "aggregate"` — verifies pipeline metrics summed into single "Total" series, and system metrics averaged into "Total" via avgSeries
- Downsampling — verifies 5-minute bucket averaging with `range: "7d"`
- Empty rows — verifies empty input produces empty output for all three groupBy modes (noting that aggregate mode produces `{ Total: [] }` for system metrics due to avgSeries/sumSeries always creating the key)
- Bigint handling — verifies correct numeric conversion with `BigInt()` constructor calls, large values near MAX_SAFE_INTEGER, and bigint memory fields in node rows
- Latency — verifies inclusion when provided and omission when null
- filterOptions passthrough — verifies reference identity

## Verification

- `pnpm exec vitest run --reporter=verbose` — 15/15 tests pass, 1 test file, exit 0
- `pnpm exec tsc --noEmit` — exit 0, no regressions
- `pnpm exec eslint src/` — exit 0, no regressions
- All 4 new files exist: `vitest.config.ts`, `src/__mocks__/lib/prisma.ts`, `src/server/services/__tests__/dashboard-data.test.ts`, and `package.json` has test script

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm exec vitest run --reporter=verbose` | 0 | ✅ pass | 0.4s |
| 2 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | 4.3s |
| 3 | `pnpm exec eslint src/` | 0 | ✅ pass | 8.7s |
| 4 | `test -f vitest.config.ts` | 0 | ✅ pass | <1s |
| 5 | `test -f src/__mocks__/lib/prisma.ts` | 0 | ✅ pass | <1s |
| 6 | `test -f src/server/services/__tests__/dashboard-data.test.ts` | 0 | ✅ pass | <1s |
| 7 | `grep -q '"test"' package.json` | 0 | ✅ pass | <1s |

## Diagnostics

- Run `pnpm exec vitest run --reporter=verbose` to see all test results with durations
- Run `pnpm exec vitest run --reporter=verbose -- dashboard-data` to run only the dashboard-data tests
- On failure, vitest shows assertion diffs with expected/received values and exact source locations

## Deviations

- Used `BigInt()` constructor calls instead of bigint literal syntax (`0n`) in test fixtures because the project tsconfig targets ES2017, which does not support bigint literals. The tests run correctly at runtime since Vitest uses its own transpiler.
- Fixed the "empty rows for all groupBy modes" test expectation: aggregate mode produces `{ Total: [] }` for system metrics (not `{}`) because `avgSeries`/`sumSeries` always create the `Total` key. This is correct source code behavior, not a bug.

## Known Issues

None.

## Files Created/Modified

- `vitest.config.ts` — new; Vitest config with `@/` path alias and test discovery settings
- `package.json` — modified; added `vitest` and `vitest-mock-extended` to devDependencies, added `"test": "vitest run"` script
- `src/__mocks__/lib/prisma.ts` — new; Prisma deep-mock helper using `mockDeep<PrismaClient>()` with beforeEach reset
- `src/server/services/__tests__/dashboard-data.test.ts` — new; 15 tests for `computeChartMetrics` pure function
