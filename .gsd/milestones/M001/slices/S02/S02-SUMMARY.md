# S02: Router & Component Refactoring — Summary

**Status:** Complete
**Duration:** ~55 minutes across 4 tasks
**Result:** All source files under ~800 lines (excluding exempt files), two new service modules, `tsc --noEmit` and `eslint src/` pass clean.

## What This Slice Delivered

Split 5 over-target files across 4 tasks, creating 8 new files and 2 new service modules. Every refactoring is structural only — zero API contract changes, zero runtime behavior changes.

### T01: Alerts Page Split (1910 → 45 lines)
Split the largest non-exempt file into 4 section components + shared constants module under `src/app/(dashboard)/alerts/_components/`:
- `alert-rules-section.tsx` (569 lines) — rule CRUD, toggle, form state
- `notification-channels-section.tsx` (750 lines) — channel CRUD, test, config form builders
- `webhooks-section.tsx` (439 lines) — legacy webhook CRUD, test
- `alert-history-section.tsx` (175 lines) — cursor-based pagination + event display
- `constants.ts` (63 lines) — shared labels and metric sets

`page.tsx` is now a 45-line composition wrapper.

### T02: Pipeline Router Service Extraction (1318 → 847 lines)
Created `src/server/services/pipeline-graph.ts` (621 lines) with 5 exported functions:
- `saveGraphComponents(tx, params)` — component validation + node/edge persistence
- `promotePipeline(params)` — cross-environment pipeline copy with secret stripping
- `discardPipelineChanges(pipelineId)` — restore graph from version snapshot
- `detectConfigChanges(params)` — YAML diff against deployed version (eliminated duplication in list/get)
- `listPipelinesForEnvironment(environmentId)` — full list query + mapping logic

Extracted 2 more functions than planned to meet the 850-line target and eliminate duplicated YAML-diff logic.

### T03: Dashboard Router Service Extraction (1074 → 652 lines)
Created `src/server/services/dashboard-data.ts` (449 lines) with 3 exported functions:
- `computeChartMetrics(params)` — time-series bucketing, downsampling, aggregation
- `assembleNodeCards(params)` — node card data assembly from raw DB results
- `assemblePipelineCards(params)` — pipeline card assembly with config generation

Service is stateless — router passes `metricStore.getLatestAll()` results as parameters.

### T04: Settings Dialog Extraction
- `team-settings.tsx` 865 → 747 lines — 4 dialogs extracted to `team-member-dialogs.tsx` (280 lines)
- `users-settings.tsx` 813 → 522 lines — 6 dialogs extracted to `user-management-dialogs.tsx` (514 lines)

## Final Line Counts

| File | Before | After | Target |
|------|--------|-------|--------|
| alerts/page.tsx | 1910 | 45 | <200 |
| pipeline.ts | 1318 | 847 | <850 |
| dashboard.ts | 1074 | 652 | <850 |
| team-settings.tsx | 865 | 747 | <800 |
| users-settings.tsx | 813 | 522 | <800 |

Top non-exempt files after S02: pipeline router (847), vrl-editor (795), notification-channels-section (750), team-settings (747), sidebar (727). All under ~800.

## Patterns Established

1. **Service extraction pattern (D004):** Pure function exports, import `prisma` from `@/lib/prisma`, throw `TRPCError` for errors, accept `Tx` parameter for transaction-scoped work. Services are stateless — all singleton/side-effect access stays in routers. Routers retain middleware chains, input parsing, and audit metadata.

2. **Dialog extraction pattern (D005):** Each dialog receives open state (member/user object or null), `onClose` callback, `isPending` boolean, and `onConfirm` callback. Parent retains mutation hooks. Concise ConfirmDialog usages stay inline.

3. **Section component pattern:** Each alert section is self-contained with its own `"use client"` directive, imports, form-state types, and tRPC hooks. Shared constants live in `_components/constants.ts`.

## What the Next Slices Should Know

- **S04 (tests):** The two new service modules (`pipeline-graph.ts`, `dashboard-data.ts`) are the primary test targets. They accept plain parameters and return data — no mocking of tRPC context needed. `pipeline-graph.ts` has 15 TRPCError throw sites that are testable failure paths. `dashboard-data.ts` is pure computation — perfect for unit tests with fixture data.

- **S05 (performance):** Refactored modules have clear boundaries for profiling. The dashboard service functions (`computeChartMetrics` with its `downsample`/`avgSeries`/`sumSeries` helpers) are isolated computation that can be benchmarked directly. `listPipelinesForEnvironment` centralizes the pipeline list query — a single place to optimize includes/selects.

- **Boundary:** `notification-channels-section.tsx` (750 lines) and `team-settings.tsx` (747 lines) are the closest to the ~800 target. They are under target and well-structured — no further splitting needed unless they grow.

## Requirements Impact

- **R003 (file size):** Validated — no non-exempt source file over ~800 lines
- **R007 (service extraction):** Validated — pipeline and dashboard routers delegate to service modules
- **R001, R008:** Still passing — `tsc --noEmit` and `eslint src/` exit 0

## Verification Evidence

All 11 slice-level verification checks pass:

| # | Check | Result |
|---|-------|--------|
| 1 | `pnpm exec tsc --noEmit` exits 0 | ✅ |
| 2 | `pnpm exec eslint src/` exits 0 | ✅ |
| 3 | `wc -l alerts/page.tsx` → 45 (< 200) | ✅ |
| 4 | `wc -l pipeline.ts` → 847 (< 850) | ✅ |
| 5 | `wc -l dashboard.ts` → 652 (< 850) | ✅ |
| 6 | `wc -l team-settings.tsx` → 747 (< 800) | ✅ |
| 7 | `wc -l users-settings.tsx` → 522 (< 800) | ✅ |
| 8 | `test -f pipeline-graph.ts` — exists | ✅ |
| 9 | `test -f dashboard-data.ts` — exists | ✅ |
| 10 | `test -d alerts/_components` — exists | ✅ |
| 11 | `find src` top files — no non-exempt over ~800 | ✅ |

## Files Created

- `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx` (569 lines)
- `src/app/(dashboard)/alerts/_components/notification-channels-section.tsx` (750 lines)
- `src/app/(dashboard)/alerts/_components/webhooks-section.tsx` (439 lines)
- `src/app/(dashboard)/alerts/_components/alert-history-section.tsx` (175 lines)
- `src/app/(dashboard)/alerts/_components/constants.ts` (63 lines)
- `src/server/services/pipeline-graph.ts` (621 lines)
- `src/server/services/dashboard-data.ts` (449 lines)
- `src/app/(dashboard)/settings/_components/team-member-dialogs.tsx` (280 lines)
- `src/app/(dashboard)/settings/_components/user-management-dialogs.tsx` (514 lines)

## Files Modified

- `src/app/(dashboard)/alerts/page.tsx` (1910 → 45 lines)
- `src/server/routers/pipeline.ts` (1318 → 847 lines)
- `src/server/routers/dashboard.ts` (1074 → 652 lines)
- `src/app/(dashboard)/settings/_components/team-settings.tsx` (865 → 747 lines)
- `src/app/(dashboard)/settings/_components/users-settings.tsx` (813 → 522 lines)
