---
id: T03
parent: S04
milestone: M001
provides:
  - 12 Prisma-mocked tests for evaluateAlerts covering firing, resolving, deduplication, binary metrics, null metrics, event-based rule skipping, and duration tracking
  - Proven vi.mock + mockDeep<PrismaClient> pattern for all downstream Prisma-mocked tests
key_files:
  - src/server/services/__tests__/alert-evaluator.test.ts
  - src/__mocks__/lib/prisma.ts
key_decisions:
  - "D006: Use inline vi.mock factory with mockDeep + direct import cast instead of shared __mocks__ helper"
patterns_established:
  - "Prisma mock pattern: vi.mock('@/lib/prisma', () => ({ prisma: mockDeep<PrismaClient>() })) then import { prisma } and cast to DeepMockProxy"
  - "Duration-tracking tests: use vi.useFakeTimers + vi.setSystemTime to simulate time progression across sequential evaluateAlerts calls"
observability_surfaces:
  - "pnpm exec vitest run --reporter=verbose -- alert-evaluator shows per-test pass/fail with durations"
duration: 20m
verification_result: passed
completed_at: 2026-03-23T09:48:00Z
blocker_discovered: false
---

# T03: Write alert-evaluator tests with Prisma mocking

**Added 12 Prisma-mocked tests for evaluateAlerts covering condition firing, resolving, deduplication, binary metrics, duration tracking, and null-metric handling — proving the vi.mock pattern for all downstream test files**

## What Happened

Created the first Prisma-mocked test file targeting `evaluateAlerts` in `alert-evaluator.ts`. The T01 mock helper used `require("@/lib/prisma")` which fails because Vitest's `@/` path alias doesn't apply to CommonJS `require()`. Discovered and validated the correct pattern: inline `vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }))` with a direct import of the mocked module cast to `DeepMockProxy`.

Wrote 12 test cases covering all planned domains:
1. **Node not found** — returns empty
2. **Skips event-based rules** — no condition/threshold → no events created
3. **Fires when condition met** — CPU 90% > threshold 80 with durationSeconds=0
4. **Deduplication** — existing firing event prevents duplicate creation
5. **Resolves when condition clears** — value drops below threshold, open event resolved
6. **Binary: node_unreachable** — UNREACHABLE status → metric value 1 → fires
7. **Binary: pipeline_crashed** — crashed count > 0 → fires
8. **Null metric** — empty nodeMetric rows → no events
9. **Duration tracking** — first call sets timer, second call after 61s fires
10. **Duration clearing** — condition drops then re-triggers → timer resets
11. **Pipeline name in message** — buildMessage includes pipeline name
12. **No enabled rules** — returns empty

Updated `src/__mocks__/lib/prisma.ts` to be a documentation-only file with the correct usage pattern, since the shared mock approach doesn't work and inline mocking is required.

## Verification

- `pnpm exec vitest run --reporter=verbose` — 84 tests pass across 5 test files (12 new alert-evaluator tests)
- `test -f src/server/services/__tests__/alert-evaluator.test.ts` — exists
- `grep -c "it(" src/server/services/__tests__/alert-evaluator.test.ts` — 12 test cases (requirement ≥ 6)
- `pnpm exec tsc --noEmit` — exits 0, no type regressions
- `pnpm exec eslint src/` — exits 0, no lint regressions

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm exec vitest run --reporter=verbose` | 0 | ✅ pass | 0.5s |
| 2 | `test -f src/server/services/__tests__/alert-evaluator.test.ts` | 0 | ✅ pass | <0.1s |
| 3 | `grep -c "it(" src/server/services/__tests__/alert-evaluator.test.ts` → 12 | 0 | ✅ pass | <0.1s |
| 4 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | 2.6s |
| 5 | `pnpm exec eslint src/` | 0 | ✅ pass | 7.9s |

## Diagnostics

- Run `pnpm exec vitest run --reporter=verbose -- alert-evaluator` to run only alert-evaluator tests
- On failure, Vitest shows assertion diffs with expected/received values and source locations
- Duration-tracking tests use `vi.useFakeTimers()` + `vi.setSystemTime()` — if tests hang, check that `afterEach` restores real timers

## Deviations

- **Mock helper pattern changed**: The T01-created `src/__mocks__/lib/prisma.ts` helper used `require("@/lib/prisma")` which fails at runtime. Replaced with inline mock pattern in the test file and converted the helper to documentation-only. This is the correct approach for Vitest + vitest-mock-extended + path aliases.
- **12 tests instead of 8**: Added "node not found", "no enabled rules", "duration clearing", and "pipeline name in message" tests beyond what the plan specified, for more complete coverage.

## Known Issues

None.

## Files Created/Modified

- `src/server/services/__tests__/alert-evaluator.test.ts` — new test file with 12 Prisma-mocked tests for evaluateAlerts
- `src/__mocks__/lib/prisma.ts` — converted from broken require-based helper to documentation of the correct inline mock pattern
- `.gsd/KNOWLEDGE.md` — updated Prisma mock pattern entry with correct inline approach
