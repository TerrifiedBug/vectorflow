---
id: T02
parent: S01
milestone: M001
provides:
  - all inline duplicate utility functions replaced with imports from shared modules
  - zero inline copies of aggregateProcessStatus, derivePipelineStatus, formatTime, STATUS_COLORS, statusColor, formatTimestamp in consumer files
key_files:
  - src/app/(dashboard)/pipelines/page.tsx
  - src/app/(dashboard)/pipelines/[id]/page.tsx
  - src/app/(dashboard)/page.tsx
  - src/components/dashboard/custom-view.tsx
  - src/components/fleet/event-log.tsx
  - src/components/fleet/status-timeline.tsx
  - src/components/fleet/node-metrics-charts.tsx
  - src/components/fleet/node-logs.tsx
  - src/components/pipeline/pipeline-logs.tsx
  - src/app/(dashboard)/audit/page.tsx
key_decisions:
  - Removed unused STATUS_COLORS import from event-log.tsx to keep eslint clean (only statusColor is needed there)
patterns_established:
  - All pipeline status logic imports from @/lib/pipeline-status; all time formatting imports from @/lib/format; all status color helpers import from @/lib/status
observability_surfaces:
  - tsc --noEmit validates all import paths and type signatures; rg confirms no inline duplicates remain; eslint catches unused imports
duration: 5m
verification_result: passed
completed_at: 2026-03-22
blocker_discovered: false
---

# T02: Replace inline duplicate definitions with imports from shared modules

**Replaced all inline duplicate utility functions across 10 consumer files with imports from shared modules in src/lib/, with zero regressions to tsc and eslint**

## What Happened

Removed inline definitions of `aggregateProcessStatus` (2 files), `derivePipelineStatus` (2 files), `formatTime` (4 files), `STATUS_COLORS`/`statusColor` (2 files), and `formatTimestamp` (1 file) from consumer files. Replaced each with imports from the shared modules created in T01 (`@/lib/pipeline-status`, `@/lib/format`, `@/lib/status`).

For `node-logs.tsx` and `pipeline-logs.tsx`, the inline `formatTime` used seconds-precision formatting (HH:MM:SS), so these were wired to `formatTimeWithSeconds` from `@/lib/format` and all call sites renamed accordingly.

After initial eslint pass revealed an unused `STATUS_COLORS` import in `event-log.tsx` (only `statusColor` was actually referenced in the component), removed the unnecessary import to achieve a clean lint.

## Verification

- `pnpm exec tsc --noEmit` — exits 0, all import paths and type signatures valid
- `pnpm exec eslint src/` — exits 0, no errors or warnings
- `rg 'function aggregateProcessStatus' src/app src/components` — exit 1, no matches
- `rg 'function derivePipelineStatus' src/app src/components` — exit 1, no matches
- `rg '^function formatTime' src/app src/components` — exit 1, no matches
- `rg '^const STATUS_COLORS' src/components/fleet` — exit 1, no matches
- `rg '^function formatTimestamp' src/app` — exit 1, no matches
- `test -f src/lib/pipeline-status.ts` — exits 0

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | 3.9s |
| 2 | `pnpm exec eslint src/` | 0 | ✅ pass | 8.4s |
| 3 | `rg 'function aggregateProcessStatus' src/app src/components` | 1 | ✅ pass | 0s |
| 4 | `rg 'function derivePipelineStatus' src/app src/components` | 1 | ✅ pass | 0s |
| 5 | `rg '^function formatTime' src/app src/components` | 1 | ✅ pass | 0s |
| 6 | `rg '^const STATUS_COLORS' src/components/fleet` | 1 | ✅ pass | 0s |
| 7 | `rg '^function formatTimestamp' src/app` | 1 | ✅ pass | 0s |
| 8 | `test -f src/lib/pipeline-status.ts` | 0 | ✅ pass | 0s |

### Slice-level checks (all passing — final task)

| # | Command | Exit Code | Verdict |
|---|---------|-----------|---------|
| 1 | `pnpm exec tsc --noEmit` | 0 | ✅ pass |
| 2 | `pnpm exec eslint src/` | 0 | ✅ pass |
| 3 | `rg 'function aggregateProcessStatus' src/app src/components` | 1 | ✅ pass |
| 4 | `rg 'function derivePipelineStatus' src/app src/components` | 1 | ✅ pass |
| 5 | `rg '^function formatTime' src/app src/components` | 1 | ✅ pass |
| 6 | `rg '^const STATUS_COLORS' src/components/fleet` | 1 | ✅ pass |
| 7 | `test -f src/lib/pipeline-status.ts` | 0 | ✅ pass |

## Diagnostics

- Verify no inline duplicates remain: `rg 'function aggregateProcessStatus|function derivePipelineStatus' src/app src/components`
- Verify shared module imports: `rg "from.*@/lib/pipeline-status" src/` and `rg "from.*@/lib/format" src/` and `rg "from.*@/lib/status" src/`
- Compilation check: `pnpm exec tsc --noEmit` — any broken import will surface immediately
- No runtime signals — pure refactoring of import paths with no behavior changes

## Deviations

- Removed unused `STATUS_COLORS` import from `event-log.tsx` — the original code defined it locally alongside `statusColor`, but the component only calls `statusColor()` directly. Importing the unused constant triggered an eslint warning.

## Known Issues

None.

## Files Created/Modified

- `src/app/(dashboard)/pipelines/page.tsx` — removed inline `aggregateProcessStatus`, added import from `@/lib/pipeline-status`
- `src/app/(dashboard)/pipelines/[id]/page.tsx` — removed inline `aggregateProcessStatus`, added import from `@/lib/pipeline-status`
- `src/app/(dashboard)/page.tsx` — removed inline `derivePipelineStatus`, added import from `@/lib/pipeline-status`
- `src/components/dashboard/custom-view.tsx` — removed inline `derivePipelineStatus`, added import from `@/lib/pipeline-status`
- `src/components/fleet/event-log.tsx` — removed inline `STATUS_COLORS`, `statusColor`, `formatTime`; added imports from `@/lib/format` and `@/lib/status`
- `src/components/fleet/status-timeline.tsx` — removed inline `STATUS_COLORS`, `statusColor`, `formatTime`; added imports from `@/lib/format` and `@/lib/status`
- `src/components/fleet/node-metrics-charts.tsx` — removed inline `formatTime`, added to existing `@/lib/format` import
- `src/components/fleet/node-logs.tsx` — removed inline `formatTime`, added `formatTimeWithSeconds` import, renamed call site
- `src/components/pipeline/pipeline-logs.tsx` — removed inline `formatTime`, added `formatTimeWithSeconds` import, renamed call site
- `src/app/(dashboard)/audit/page.tsx` — removed inline `formatTimestamp`, added import from `@/lib/format`
