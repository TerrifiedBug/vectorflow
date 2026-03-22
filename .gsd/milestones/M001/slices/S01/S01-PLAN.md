# S01: TypeScript Fixes & Shared Utilities

**Goal:** All duplicated utility functions are extracted into shared modules in `src/lib/`, with zero regressions to `tsc --noEmit` and `eslint`.
**Demo:** `tsc --noEmit` exits 0, `eslint src/` exits 0, and `rg 'function aggregateProcessStatus|function derivePipelineStatus' src/app src/components` returns no matches — all pipeline status logic lives in `src/lib/pipeline-status.ts`.

## Must-Haves

- `src/lib/pipeline-status.ts` exists with `aggregateProcessStatus()` and `derivePipelineStatus()` exports (boundary contract for S02–S05)
- `src/lib/format.ts` exports `formatTime()` (HH:MM) and `formatTimeWithSeconds()` (HH:MM:SS) alongside existing helpers
- `src/lib/status.ts` exports `STATUS_COLORS` and `statusColor()` alongside existing status variant helpers
- All 9 consumer files import from shared modules instead of defining inline duplicates
- `tsc --noEmit` exits 0 (R001 — already passing, must not regress)
- `eslint src/` exits 0 (R008 — already passing, must not regress)

## Verification

- `pnpm exec tsc --noEmit` exits 0
- `pnpm exec eslint src/` exits 0
- `rg 'function aggregateProcessStatus' src/app src/components` returns no matches
- `rg 'function derivePipelineStatus' src/app src/components` returns no matches
- `rg '^function formatTime' src/app src/components` returns no matches
- `rg '^const STATUS_COLORS' src/components/fleet` returns no matches
- `test -f src/lib/pipeline-status.ts` exits 0

## Tasks

- [ ] **T01: Create shared utility modules for pipeline status, time formatting, and status colors** `est:20m`
  - Why: Establishes the shared modules that all consumer files will import from. Creates `src/lib/pipeline-status.ts` (boundary contract for downstream slices) and extends `src/lib/format.ts` and `src/lib/status.ts` with extracted functions.
  - Files: `src/lib/pipeline-status.ts`, `src/lib/format.ts`, `src/lib/status.ts`
  - Do: (1) Create `src/lib/pipeline-status.ts` with `aggregateProcessStatus()` and `derivePipelineStatus()` copied from existing inline definitions. (2) Add `formatTime()` (HH:MM variant) and `formatTimeWithSeconds()` (HH:MM:SS variant) to `src/lib/format.ts`. (3) Add `STATUS_COLORS` constant and `statusColor()` function to `src/lib/status.ts`. (4) Update the shared `formatTimestamp` in `src/lib/format.ts` to use explicit locale options (year, month, day, hour, minute, second) matching the audit page's more detailed version.
  - Verify: `pnpm exec tsc --noEmit` exits 0 (new exports compile cleanly)
  - Done when: All three shared modules export the new functions and `tsc --noEmit` passes

- [ ] **T02: Replace inline duplicate definitions with imports from shared modules** `est:25m`
  - Why: Completes R004 by removing all inline duplicates and wiring consumers to the shared modules. This is the task that actually eliminates duplication.
  - Files: `src/app/(dashboard)/pipelines/page.tsx`, `src/app/(dashboard)/pipelines/[id]/page.tsx`, `src/app/(dashboard)/page.tsx`, `src/components/dashboard/custom-view.tsx`, `src/components/fleet/event-log.tsx`, `src/components/fleet/status-timeline.tsx`, `src/components/fleet/node-metrics-charts.tsx`, `src/components/fleet/node-logs.tsx`, `src/components/pipeline/pipeline-logs.tsx`
  - Do: In each consumer file: (1) Add import for the shared function(s) from `@/lib/pipeline-status`, `@/lib/format`, or `@/lib/status`. (2) Delete the inline function definition. (3) Verify the imported name matches usage — for the HH:MM:SS variant in `node-logs.tsx` and `pipeline-logs.tsx`, import `formatTimeWithSeconds` and alias or rename at call sites. Also update `src/app/(dashboard)/audit/page.tsx` to import `formatTimestamp` from `@/lib/format` and delete the local definition.
  - Verify: `pnpm exec tsc --noEmit` exits 0 && `pnpm exec eslint src/` exits 0 && `rg 'function aggregateProcessStatus' src/app src/components` returns nothing
  - Done when: No inline duplicate definitions remain in consumer files, all imports resolve, `tsc` and `eslint` both exit 0

## Files Likely Touched

- `src/lib/pipeline-status.ts` (new)
- `src/lib/format.ts` (extend)
- `src/lib/status.ts` (extend)
- `src/app/(dashboard)/pipelines/page.tsx`
- `src/app/(dashboard)/pipelines/[id]/page.tsx`
- `src/app/(dashboard)/page.tsx`
- `src/components/dashboard/custom-view.tsx`
- `src/components/fleet/event-log.tsx`
- `src/components/fleet/status-timeline.tsx`
- `src/components/fleet/node-metrics-charts.tsx`
- `src/components/fleet/node-logs.tsx`
- `src/components/pipeline/pipeline-logs.tsx`
- `src/app/(dashboard)/audit/page.tsx`
