---
estimated_steps: 4
estimated_files: 2
skills_used:
  - lint
  - review
---

# T03: Extract dashboard router computation to service module

**Slice:** S02 — Router & Component Refactoring
**Milestone:** M001

## Description

The dashboard router (`src/server/routers/dashboard.ts`, 1074 lines) contains 12 tRPC procedures. The `chartMetrics` endpoint (L604-964, ~360 lines) has the largest block of inline logic: time-series bucketing, downsampling, CPU/memory delta computation, and groupBy aggregation across pipeline/node/aggregate modes. It also contains local utility functions (`addPoint`, `downsample`, `avgSeries`, `sumSeries`) that belong in a service module. `nodeCards` (L106-251, ~145 lines) and `pipelineCards` (L252-422, ~170 lines) have substantial inline data assembly.

Extracting these to `src/server/services/dashboard-data.ts` brings the router well under 800 lines and produces a testable service for S04.

**Key constraint from research:** The dashboard router imports `metricStore` (a singleton in-memory metric store at `@/server/services/metric-store`). The service extraction MUST NOT import `metricStore` in the service — the router passes `metricStore.getLatestAll()` results as a parameter to extracted functions, keeping the service layer stateless.

## Steps

1. **Read the dashboard router** to understand the full handler bodies for `chartMetrics` (L604-964), `nodeCards` (L106-251), and `pipelineCards` (L252-422). Identify local utility functions (`addPoint`, `downsample`, `avgSeries`, `sumSeries`) and their parameter types. Map all `metricStore` access points (L167, L306).

2. **Create `src/server/services/dashboard-data.ts`** with exported functions:
   - `computeChartMetrics(dbResults: ..., latestSamples: ..., options: ...)` — the full time-series computation from `chartMetrics`. Include the `addPoint`, `downsample`, `avgSeries`, `sumSeries` utility functions as module-private helpers. Accept DB query results and metric samples as parameters (NOT `metricStore` directly).
   - `assembleNodeCards(nodes: ..., latestSamples: ...)` — the data assembly from `nodeCards`. Accept raw DB results and metric samples.
   - `assemblePipelineCards(pipelines: ..., latestSamples: ...)` — the data assembly from `pipelineCards`. Same pattern.
   - Follow the existing service pattern: direct function exports, import types from `@/generated/prisma`.
   - Do NOT import `metricStore` — the service must remain stateless.

3. **Update the dashboard router** to import and call the service functions. Each handler: run DB query, get metric samples from `metricStore`, pass both to service function, return result. The router stays responsible for DB queries and `metricStore` access — the service does pure computation.

4. **Verify** `tsc --noEmit` and `eslint src/` both pass. Check `wc -l` on the router to confirm under ~800 lines.

## Must-Haves

- [ ] `dashboard-data.ts` service module exists with exported functions for chartMetrics, nodeCards, and pipelineCards logic
- [ ] Dashboard router under ~800 lines
- [ ] `metricStore` import stays in the router only — NOT imported in the service
- [ ] Service functions are stateless — accept data as parameters, return computed results
- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm exec eslint src/` exits 0
- [ ] No API contract changes

## Verification

- `pnpm exec tsc --noEmit` exits 0
- `pnpm exec eslint src/` exits 0
- `wc -l src/server/routers/dashboard.ts` — under 850 lines
- `test -f src/server/services/dashboard-data.ts`
- `! grep -q 'metricStore' src/server/services/dashboard-data.ts` — NOT imported in service
- `grep -q 'metricStore' src/server/routers/dashboard.ts` — still in router

## Inputs

- `src/server/routers/dashboard.ts` — the 1074-line router to refactor
- `src/server/services/pipeline-version.ts` — reference for the service module pattern

## Expected Output

- `src/server/services/dashboard-data.ts` — new service module with computation functions (~500 lines)
- `src/server/routers/dashboard.ts` — slimmed router delegating to service (~550 lines)
