---
id: S01
parent: M001
milestone: M001
provides:
  - src/lib/pipeline-status.ts with aggregateProcessStatus() and derivePipelineStatus() (boundary contract for S02–S05)
  - src/lib/format.ts extended with formatTime() and formatTimeWithSeconds()
  - src/lib/status.ts extended with STATUS_COLORS and statusColor()
  - formatTimestamp() updated with explicit locale options matching audit page
  - zero inline duplicate utility definitions across 10 consumer files
  - tsc --noEmit exits 0 baseline preserved
  - eslint src/ exits 0 baseline preserved
requires:
  - slice: none
    provides: first slice — no dependencies
affects:
  - S02
  - S03
  - S04
  - S05
key_files:
  - src/lib/pipeline-status.ts
  - src/lib/format.ts
  - src/lib/status.ts
key_decisions:
  - Matched reference implementations exactly (no logic changes) to ensure zero-risk extraction
  - Removed unused STATUS_COLORS import from event-log.tsx to keep eslint clean (only statusColor is needed there)
patterns_established:
  - All pipeline status derivation logic imports from @/lib/pipeline-status — no inline definitions
  - All time formatting (HH:MM via formatTime, HH:MM:SS via formatTimeWithSeconds, timestamp via formatTimestamp) imports from @/lib/format
  - Node health color mapping (STATUS_COLORS, statusColor) lives in @/lib/status alongside status variant helpers
observability_surfaces:
  - tsc --noEmit validates all export type signatures and import paths
  - rg 'function aggregateProcessStatus' src/app src/components confirms no inline duplicates
  - rg 'export function|export const' src/lib/pipeline-status.ts src/lib/format.ts src/lib/status.ts shows full shared API surface
drill_down_paths:
  - .gsd/milestones/M001/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M001/slices/S01/tasks/T02-SUMMARY.md
duration: 10m
verification_result: passed
completed_at: 2026-03-22
---

# S01: TypeScript Fixes & Shared Utilities

**Extracted 7 duplicated utility functions from 10 consumer files into 3 shared modules in `src/lib/`, maintaining zero TS and eslint errors**

## What Happened

T01 created the shared modules: `src/lib/pipeline-status.ts` (new, with `aggregateProcessStatus` and `derivePipelineStatus`), and extended `src/lib/format.ts` (with `formatTime` and `formatTimeWithSeconds`) and `src/lib/status.ts` (with `STATUS_COLORS` and `statusColor`). All implementations were copied verbatim from their reference sources to ensure behavioral equivalence — no logic changes.

T02 wired all 10 consumer files to import from the shared modules and deleted every inline duplicate. Files importing the HH:MM:SS variant (`node-logs.tsx`, `pipeline-logs.tsx`) were switched to `formatTimeWithSeconds` with call sites renamed. An unused `STATUS_COLORS` import in `event-log.tsx` was removed to satisfy eslint — the component only uses `statusColor()` directly.

The `formatTimestamp` function in `format.ts` was also updated to use explicit locale options (year, month, day, hour, minute, second), matching the audit page's more detailed formatting. The audit page's local definition was then replaced with an import.

## Verification

| # | Check | Result |
|---|-------|--------|
| 1 | `pnpm exec tsc --noEmit` exits 0 | ✅ pass |
| 2 | `pnpm exec eslint src/` exits 0 | ✅ pass |
| 3 | `rg 'function aggregateProcessStatus' src/app src/components` — no matches | ✅ pass |
| 4 | `rg 'function derivePipelineStatus' src/app src/components` — no matches | ✅ pass |
| 5 | `rg '^function formatTime' src/app src/components` — no matches | ✅ pass |
| 6 | `rg '^const STATUS_COLORS' src/components/fleet` — no matches | ✅ pass |
| 7 | `rg '^function formatTimestamp' src/app` — no matches | ✅ pass |
| 8 | `test -f src/lib/pipeline-status.ts` — exists | ✅ pass |

## Requirements Advanced

- R001 — `tsc --noEmit` exits 0, no regression introduced by refactoring
- R004 — All duplicated utility functions extracted to shared modules; grep confirms zero inline copies remain
- R008 — `eslint src/` exits 0, no regression introduced by refactoring

## Requirements Validated

- None — R001, R004, and R008 are advanced but not yet validated (R001/R008 need to hold across all slices; R004 has supporting work in S02)

## Requirements Invalidated or Re-scoped

- None

## New Requirements Surfaced

- None

## Deviations

None — both tasks matched the plan exactly. The only minor adjustment was removing an unused `STATUS_COLORS` import in `event-log.tsx` that the plan didn't anticipate, because the original code defined it locally but only used `statusColor()`.

## Known Limitations

- `formatTimestamp` locale options change is a minor formatting difference on the audit page (now includes explicit year/month/day/hour/minute/second). This matches the existing behavior but the explicit options may render slightly differently on edge-case locales.
- S02 may discover additional duplicates during file splitting that weren't visible in the duplication audit.

## Follow-ups

- None — all planned work completed.

## Files Created/Modified

- `src/lib/pipeline-status.ts` — new shared module with `aggregateProcessStatus` and `derivePipelineStatus`
- `src/lib/format.ts` — added `formatTime`, `formatTimeWithSeconds`; updated `formatTimestamp` with explicit locale options
- `src/lib/status.ts` — added `STATUS_COLORS` constant and `statusColor` function
- `src/app/(dashboard)/pipelines/page.tsx` — replaced inline `aggregateProcessStatus` with import
- `src/app/(dashboard)/pipelines/[id]/page.tsx` — replaced inline `aggregateProcessStatus` with import
- `src/app/(dashboard)/page.tsx` — replaced inline `derivePipelineStatus` with import
- `src/components/dashboard/custom-view.tsx` — replaced inline `derivePipelineStatus` with import
- `src/components/fleet/event-log.tsx` — replaced inline `STATUS_COLORS`, `statusColor`, `formatTime` with imports
- `src/components/fleet/status-timeline.tsx` — replaced inline `STATUS_COLORS`, `statusColor`, `formatTime` with imports
- `src/components/fleet/node-metrics-charts.tsx` — replaced inline `formatTime` with import
- `src/components/fleet/node-logs.tsx` — replaced inline `formatTime` with `formatTimeWithSeconds` import
- `src/components/pipeline/pipeline-logs.tsx` — replaced inline `formatTime` with `formatTimeWithSeconds` import
- `src/app/(dashboard)/audit/page.tsx` — replaced inline `formatTimestamp` with import

## Forward Intelligence

### What the next slice should know
- All shared utilities live in `src/lib/pipeline-status.ts`, `src/lib/format.ts`, and `src/lib/status.ts`. Import from `@/lib/pipeline-status`, `@/lib/format`, `@/lib/status` respectively.
- `aggregateProcessStatus` takes a `processes` array with `status` fields and returns an aggregate status string. `derivePipelineStatus` takes pipeline data and returns derived status. See `src/lib/pipeline-status.ts` for exact signatures.
- The `formatTime` (HH:MM) vs `formatTimeWithSeconds` (HH:MM:SS) distinction matters — log viewers use seconds precision, dashboard cards use minutes.

### What's fragile
- `formatTimestamp` locale options are now explicit — if the Intl API behavior changes across Node versions or the audit page's formatting expectations shift, this could produce subtle differences. Low risk but worth knowing.

### Authoritative diagnostics
- `pnpm exec tsc --noEmit` — the single most reliable check; catches any import/export mismatch across the entire codebase
- `rg 'export function|export const' src/lib/pipeline-status.ts src/lib/format.ts src/lib/status.ts` — shows the complete shared API surface at a glance

### What assumptions changed
- No assumptions changed. The codebase was in the expected state and all reference implementations matched their audit descriptions exactly.
