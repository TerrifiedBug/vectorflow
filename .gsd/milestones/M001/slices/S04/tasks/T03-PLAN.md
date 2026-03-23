---
estimated_steps: 3
estimated_files: 2
skills_used:
  - test
---

# T03: Write alert-evaluator tests with Prisma mocking

**Slice:** S04 — Foundational Test Suite
**Milestone:** M001

## Description

Write the first Prisma-mocked test file, targeting `evaluateAlerts` in `alert-evaluator.ts`. This proves the `vi.mock('@/lib/prisma')` + `vitest-mock-extended` pattern works for all downstream tests. The alert evaluator has rich business logic: condition checking (gt/lt/eq), duration tracking via an in-memory `conditionFirstSeen` Map, firing vs resolving events, and deduplication of existing firing events.

Key technical consideration: `alert-evaluator.ts` has module-level state (the `conditionFirstSeen` Map). Each test file gets a fresh module scope in Vitest by default, but tests within the same file share the Map. The duration-tracking tests must account for this by calling `evaluateAlerts` sequentially to simulate the polling behavior.

The private helpers (`checkCondition`, `readMetricValue`, `buildMessage`) are exercised indirectly through `evaluateAlerts` — they don't need separate tests.

## Steps

1. Create `src/server/services/__tests__/alert-evaluator.test.ts`:
   - Mock `@/lib/prisma` using the helper from `src/__mocks__/lib/prisma.ts`:
     ```typescript
     import { vi, describe, it, expect, beforeEach } from 'vitest';
     vi.mock('@/lib/prisma');
     import { prismaMock } from '@/__mocks__/lib/prisma';
     ```
   - Import `evaluateAlerts` from `@/server/services/alert-evaluator`
   - Call `prismaMock` resets in `beforeEach` (the mock helper already does this, but verify)

2. Write test cases covering the full evaluation flow:
   - **"skips event-based rules"** — mock a rule with `condition: null, threshold: null`, verify no events created
   - **"fires when condition met beyond duration"** — mock a `cpu_usage` rule with `condition: 'gt', threshold: 80, durationSeconds: 0`. Mock `vectorNode.findUnique` to return `{ status: 'RUNNING' }`. Mock `nodeMetric.findMany` to return 2 rows that compute to 90% CPU. Mock `alertEvent.findFirst` to return null (no existing event). Mock `alertEvent.create` to return a new event. Verify `evaluateAlerts` returns one firing event.
   - **"does not fire duplicate when existing firing event exists"** — same setup but mock `alertEvent.findFirst` to return an existing firing event. Verify result is empty.
   - **"resolves when condition clears"** — mock values below threshold. Mock `alertEvent.findFirst` to return an open firing event. Mock `alertEvent.update`. Verify result contains a resolved event.
   - **"handles binary metric: node_unreachable"** — mock a rule with `metric: 'node_unreachable', condition: 'eq', threshold: 1`. Mock node status as `'UNREACHABLE'`. Verify event fires.
   - **"handles binary metric: pipeline_crashed"** — mock `nodePipelineStatus.count` to return > 0. Verify event fires.
   - **"returns empty when metric value is null"** — mock `nodeMetric.findMany` returning empty array (CPU can't be computed). Verify no events.
   - **"respects duration tracking"** — call `evaluateAlerts` twice with the same overdue condition. First call should set `conditionFirstSeen` and fire (if durationSeconds is 0). For nonzero durationSeconds, first call sets the timer, second call (after sufficient simulated time) fires.

3. Ensure tests run correctly alongside existing test files:
   - `pnpm exec vitest run --reporter=verbose` — all 5 test files pass (1 from T01, 3 from T02, 1 new)

## Must-Haves

- [ ] `vi.mock('@/lib/prisma')` pattern successfully intercepts Prisma calls
- [ ] Tests cover: firing, resolving, deduplication, binary metrics, null metric handling, event-based rule skipping
- [ ] All tests pass with `pnpm test`

## Verification

- `pnpm exec vitest run --reporter=verbose` exits 0 with all 5 test files passing
- `test -f src/server/services/__tests__/alert-evaluator.test.ts`
- The alert-evaluator test file has at least 6 test cases (verify with `grep -c "it(" src/server/services/__tests__/alert-evaluator.test.ts`)

## Inputs

- `src/server/services/alert-evaluator.ts` — the module under test; single export `evaluateAlerts(nodeId, environmentId)`, imports `prisma` from `@/lib/prisma`, has module-level `conditionFirstSeen` Map, private helpers: `checkCondition`, `getCpuUsage`, `getMemoryUsage`, `getDiskUsage`, `getErrorRate`, `getDiscardedRate`, `getPipelineCrashed`, `readMetricValue`, `buildMessage`. Uses Prisma models: `vectorNode`, `alertRule`, `alertEvent`, `nodeMetric`, `nodePipelineStatus`. Types imported from `@/generated/prisma`: `AlertMetric`, `AlertCondition`, `AlertRule`, `AlertEvent`.
- `src/__mocks__/lib/prisma.ts` — created in T01; provides `prismaMock` typed as `DeepMockProxy<PrismaClient>`
- `vitest.config.ts` — created in T01

## Expected Output

- `src/server/services/__tests__/alert-evaluator.test.ts` — new test file proving Prisma mocking pattern works, covering alert evaluation domain of R002
