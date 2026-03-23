---
id: T03
parent: S02
milestone: M001
provides:
  - dashboard-data.ts service module with computeChartMetrics, assembleNodeCards, assemblePipelineCards
  - dashboard router slimmed from 1074 to 652 lines
key_files:
  - src/server/services/dashboard-data.ts
  - src/server/routers/dashboard.ts
key_decisions:
  - Service functions accept DB query results and latestSamples Map as parameters, not metricStore directly, keeping the service stateless
  - assemblePipelineCards retains generateVectorYaml and decryptNodeConfig imports in the service (pure computation, no singleton access)
patterns_established:
  - Dashboard service extraction pattern: router runs DB queries + metricStore access, passes results to pure service functions for computation
observability_surfaces:
  - none (pure structural refactor — no new runtime signals)
duration: 15m
verification_result: passed
completed_at: 2026-03-23
blocker_discovered: false
---

# T03: Extract dashboard router computation to service module

**Extracted chartMetrics, nodeCards, and pipelineCards computation from 1074-line dashboard router to stateless dashboard-data.ts service; router is now 652 lines**

## What Happened

Created `src/server/services/dashboard-data.ts` with three exported functions:
- `computeChartMetrics()` — the full time-series bucketing, downsampling, CPU/memory delta computation, and groupBy aggregation logic (~360 lines of inline code from the `chartMetrics` endpoint). Includes `addPoint`, `downsample`, `avgSeries`, `sumSeries` as module-private helpers.
- `assembleNodeCards()` — node card data assembly with metric rate aggregation by component kind (SOURCE/SINK) and sparkline computation.
- `assemblePipelineCards()` — pipeline card data assembly with rate aggregation, undeployed-changes detection via YAML diff, and sparkline generation.

The dashboard router now follows the pattern: run DB queries → get metric samples from `metricStore` → pass both to service function → return result. The `metricStore` singleton import stays exclusively in the router; the service accepts `Map<string, MetricSample>` as a parameter, keeping it fully stateless and testable.

The service imports `generateVectorYaml` and `decryptNodeConfig` (used by `assemblePipelineCards` for YAML-diff detection), which are pure computation utilities — no singleton or side-effect access.

## Verification

- `pnpm exec tsc --noEmit` — exits 0 (clean)
- `pnpm exec eslint src/` — exits 0 (clean)
- `wc -l src/server/routers/dashboard.ts` — 652 lines (well under 850 target)
- `wc -l src/server/services/dashboard-data.ts` — 624 lines
- `metricStore` NOT imported in service (grep confirms)
- `metricStore` still imported in router (grep confirms)
- `test -f src/server/services/dashboard-data.ts` — exists

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | ~15s |
| 2 | `pnpm exec eslint src/` | 0 | ✅ pass | ~10s |
| 3 | `wc -l src/server/routers/dashboard.ts` (652) | 0 | ✅ pass | <1s |
| 4 | `test -f src/server/services/dashboard-data.ts` | 0 | ✅ pass | <1s |
| 5 | `! grep -q 'metricStore' src/server/services/dashboard-data.ts` | 0 | ✅ pass | <1s |
| 6 | `grep -q 'metricStore' src/server/routers/dashboard.ts` | 0 | ✅ pass | <1s |
| 7 | `wc -l src/app/(dashboard)/alerts/page.tsx` (45) | 0 | ✅ pass | <1s |
| 8 | `wc -l src/server/routers/pipeline.ts` (847) | 0 | ✅ pass | <1s |
| 9 | `test -f src/server/services/pipeline-graph.ts` | 0 | ✅ pass | <1s |
| 10 | `test -d src/app/(dashboard)/alerts/_components` | 0 | ✅ pass | <1s |
| 11 | `grep -r 'TRPCError' src/server/services/pipeline-graph.ts` (15 hits) | 0 | ✅ pass | <1s |

### Slice-level verification status (T03 is task 3 of 4):
- ✅ `tsc --noEmit` exits 0
- ✅ `eslint src/` exits 0
- ✅ alerts page under 200 lines (45)
- ✅ pipeline router under 850 lines (847)
- ✅ dashboard router under 850 lines (652)
- ⏳ team-settings.tsx under 800 lines (currently 865 — T04 will address)
- ⏳ users-settings.tsx under 800 lines (currently 813 — T04 will address)
- ✅ pipeline-graph.ts exists
- ✅ dashboard-data.ts exists
- ✅ alerts _components directory exists
- ⏳ no non-exempt file over ~800 lines (settings files remain — T04 will address)

## Diagnostics

This is a pure structural refactor with no new runtime signals. If a dashboard endpoint breaks after this change, the tRPC error boundary surfaces it as a 500, and the audit middleware logs the procedure name + error. To verify correctness: load any dashboard page and confirm stats, node cards, pipeline cards, and chart metrics render correctly.

## Deviations

None. The extraction followed the plan exactly, with the router dropping from 1074 to 652 lines (better than the ~550 estimate because the service absorbed more logic than anticipated — utility functions and type definitions moved cleanly).

## Known Issues

None.

## Files Created/Modified

- `src/server/services/dashboard-data.ts` — new service module with `computeChartMetrics`, `assembleNodeCards`, `assemblePipelineCards` (624 lines)
- `src/server/routers/dashboard.ts` — slimmed router delegating computation to service (1074 → 652 lines)
