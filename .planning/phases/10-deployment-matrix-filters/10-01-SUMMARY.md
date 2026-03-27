---
phase: 10-deployment-matrix-filters
plan: 01
subsystem: ui
tags: [trpc, fleet, filters, url-params, react, next-navigation]

# Dependency graph
requires: []
provides:
  - tags field in listWithPipelineStatus deployedPipelines tRPC response
  - useMatrixFilters hook with URL-synced search/status/tag state
  - DeploymentMatrixToolbar component with search, status chips, tag popover, clear button
affects:
  - 10-02 (wires toolbar + useMemo filtering into fleet page)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - URL-synced filter state via useSearchParams + router.replace({ scroll: false })
    - Presentational toolbar component accepting all filter state as props
    - 200ms debounce on search input using useRef + setTimeout with external state sync

key-files:
  created:
    - src/hooks/use-matrix-filters.ts
    - src/components/fleet/DeploymentMatrixToolbar.tsx
  modified:
    - src/server/routers/fleet.ts

key-decisions:
  - "Additive tRPC extension: tags added to listWithPipelineStatus response without breaking existing consumers"
  - "URL is the single source of truth for filter state per D-06; no useState duplication"
  - "DeploymentMatrixToolbar is purely presentational — state ownership belongs to the page via useMatrixFilters"
  - "Status options are Running/Stopped/Crashed only — no Draft since matrix shows deployed pipelines exclusively"
  - "200ms debounce (not 300ms from PipelineListToolbar) per D-02"

patterns-established:
  - "useMatrixFilters: useSearchParams + router.replace with scroll: false for all filter writes"
  - "DeploymentMatrixToolbar: same prop contract shape as PipelineListToolbar for consistency"

requirements-completed: [MATRIX-01, MATRIX-02, MATRIX-03, MATRIX-04]

# Metrics
duration: 5min
completed: 2026-03-27
---

# Phase 10 Plan 01: Deployment Matrix Filters — Foundation Summary

**Extended listWithPipelineStatus with tags, created useMatrixFilters URL-sync hook, and built DeploymentMatrixToolbar with search/status/tag controls**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-27T16:00:00Z
- **Completed:** 2026-03-27T16:03:48Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Extended `listWithPipelineStatus` tRPC query to return `tags` on `deployedPipelines` (additive, backward-compatible)
- Created `useMatrixFilters` hook: URL-synced search/status/tag state via `useSearchParams` + `router.replace({ scroll: false })`
- Created `DeploymentMatrixToolbar`: search input (200ms debounce), Running/Stopped/Crashed status chips, tag multi-select popover, clear-all button

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend listWithPipelineStatus and create useMatrixFilters hook** - `232eb96` (feat)
2. **Task 2: Create DeploymentMatrixToolbar component** - `5b27bfb` (feat)

## Files Created/Modified

- `src/server/routers/fleet.ts` - Added `tags: true` to Prisma select and `tags: (p.tags as string[]) ?? []` to response mapping
- `src/hooks/use-matrix-filters.ts` - New hook: reads/writes search/status/tags URL params with clearFilters and hasActiveFilters
- `src/components/fleet/DeploymentMatrixToolbar.tsx` - New presentational toolbar component matching PipelineListToolbar pattern

## Decisions Made

- No Draft status chip — the matrix shows only deployed pipelines so Draft is irrelevant
- Used 200ms debounce per D-02 (PipelineListToolbar uses 300ms — intentional difference for matrix)
- All setters wrapped in `useCallback` with `[searchParams, router]` deps per hook best practices
- Clear filters button also calls `onSearchChange("")` inline to reset local debounce state in toolbar

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Plan 02 (10-02) can now:
- Call `useMatrixFilters()` in fleet/page.tsx to get URL-synced filter state
- Pass filter state as props to `DeploymentMatrixToolbar`
- Compute `filteredDeployedPipelines` with `useMemo` using the hook's `search`, `statusFilter`, `tagFilter`
- Derive `availableTags` from the `tags` now present in `deployedPipelines`

No blockers.

---
*Phase: 10-deployment-matrix-filters*
*Completed: 2026-03-27*
