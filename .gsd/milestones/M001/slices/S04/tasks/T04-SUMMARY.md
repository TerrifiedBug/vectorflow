---
id: T04
parent: S04
milestone: M001
provides:
  - 13 Prisma-mocked tests for pipeline-graph covering detectConfigChanges, saveGraphComponents error paths, and listPipelinesForEnvironment
  - 8 Prisma-mocked tests for deploy-agent covering deployAgent error/success paths, prebuilt YAML, system vector, push notifications, and undeployAgent
  - Complete S04 slice: 7 test files, 105 tests across all four R002 domains
key_files:
  - src/server/services/__tests__/pipeline-graph.test.ts
  - src/server/services/__tests__/deploy-agent.test.ts
key_decisions: []
patterns_established:
  - "Multi-module mocking: vi.mock for config-crypto, config-generator, copy-pipeline-graph, strip-env-refs alongside Prisma mock — each module gets its own vi.mock factory"
  - "Tx parameter mocking: pass prismaMock cast as unknown as Tx — the deep mock satisfies the Prisma.TransactionClient interface"
  - "pushRegistry singleton mock: vi.mock returns { pushRegistry: { send: vi.fn() } } to mock the singleton instance's methods"
observability_surfaces:
  - "pnpm exec vitest run --reporter=verbose -- pipeline-graph shows per-test pass/fail with durations"
  - "pnpm exec vitest run --reporter=verbose -- deploy-agent shows per-test pass/fail with durations"
duration: 15m
verification_result: passed
completed_at: 2026-03-23T09:17:00Z
blocker_discovered: false
---

# T04: Write pipeline-graph and deploy-agent tests with Prisma mocking

**Added 21 Prisma-mocked tests for pipeline-graph and deploy-agent completing the S04 test suite — 7 test files with 105 passing tests across all four R002 domains**

## What Happened

Created the final two test files for the S04 foundational test suite:

**pipeline-graph.test.ts (13 tests):**
- `detectConfigChanges`: 6 tests covering no-version, null configYaml, matching YAML, differing YAML, log-level change detection, and generateVectorYaml error handling
- `saveGraphComponents`: 3 tests covering pipeline-not-found (TRPCError NOT_FOUND), shared-component-not-found (TRPCError BAD_REQUEST), and successful save with decrypted configs
- `listPipelinesForEnvironment`: 4 tests covering empty environment, mapped pipelines with computed fields, stale shared component detection, and draft pipeline behavior

Required mocking 5 modules: `@/lib/prisma`, `@/lib/config-generator`, `@/server/services/config-crypto`, `@/server/services/copy-pipeline-graph`, `@/server/services/strip-env-refs`. The `saveGraphComponents` function accepts a `Tx` (transaction client) parameter — passing `prismaMock` cast as the Tx type works because DeepMockProxy satisfies the Prisma.TransactionClient interface.

**deploy-agent.test.ts (8 tests):**
- `deployAgent`: 6 tests covering pipeline-not-found, validation failure, successful deployment, prebuilt YAML bypass, system vector start, and push notifications to matching nodes
- `undeployAgent`: 2 tests covering pipeline-not-found and successful undeploy (marks as draft)

Required mocking 8 modules: prisma, config-generator, validator, pipeline-version, git-sync, push-registry, config-crypto, system-vector. The `pushRegistry` singleton required a special mock pattern: `{ pushRegistry: { send: vi.fn() } }`.

All tests pass first try with no debugging required.

## Verification

- `pnpm exec vitest run --reporter=verbose` — 105 tests pass across 7 test files (21 new)
- `pnpm exec tsc --noEmit` — exits 0, no type regressions
- `pnpm exec eslint src/` — exits 0, no lint regressions
- `test -f src/server/services/__tests__/pipeline-graph.test.ts` — exists
- `test -f src/server/services/__tests__/deploy-agent.test.ts` — exists
- All 7 required test files exist (verified via `ls`)

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm exec vitest run --reporter=verbose` | 0 | ✅ pass | 0.5s |
| 2 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | 8.0s |
| 3 | `pnpm exec eslint src/` | 0 | ✅ pass | 8.0s |
| 4 | `test -f src/server/services/__tests__/pipeline-graph.test.ts` | 0 | ✅ pass | <0.1s |
| 5 | `test -f src/server/services/__tests__/deploy-agent.test.ts` | 0 | ✅ pass | <0.1s |
| 6 | `grep -c "it(" pipeline-graph.test.ts` → 13 | 0 | ✅ pass | <0.1s |
| 7 | `grep -c "it(" deploy-agent.test.ts` → 8 | 0 | ✅ pass | <0.1s |

## Diagnostics

- Run `pnpm exec vitest run --reporter=verbose -- pipeline-graph` to run only pipeline-graph tests
- Run `pnpm exec vitest run --reporter=verbose -- deploy-agent` to run only deploy-agent tests
- On failure, Vitest shows assertion diffs with expected/received values and exact source locations
- TRPCError assertions verify both `code` and `message` fields for precise error path coverage

## Deviations

- **Extended test coverage beyond plan**: Added tests for `detectConfigChanges` error-catch path, log-level change detection, successful `saveGraphComponents`, stale shared components in `listPipelinesForEnvironment`, prebuilt YAML in `deployAgent`, system vector startup, and push notifications — going beyond the minimum specified in the plan for more thorough coverage.
- **Added `undeployAgent` tests**: The plan didn't explicitly list `undeployAgent` tests but the function is exported from the same module and benefits from coverage.

## Known Issues

None.

## Files Created/Modified

- `src/server/services/__tests__/pipeline-graph.test.ts` — new test file with 13 tests for pipeline CRUD domain (detectConfigChanges, saveGraphComponents, listPipelinesForEnvironment)
- `src/server/services/__tests__/deploy-agent.test.ts` — new test file with 8 tests for deploy domain (deployAgent, undeployAgent)
- `.gsd/milestones/M001/slices/S04/tasks/T04-PLAN.md` — added Observability Impact section
- `.gsd/milestones/M001/slices/S04/S04-PLAN.md` — marked T04 as done
