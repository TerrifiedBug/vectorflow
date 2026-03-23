---
id: T02
parent: S03
milestone: M001
provides:
  - QueryError error handling on all 9 core dashboard pages
  - EmptyState component wired into 8 of 9 core dashboard pages (replacing inline border-dashed patterns)
  - Loading skeleton on analytics page
  - "Select environment" guard on dashboard main page
key_files:
  - src/app/(dashboard)/page.tsx
  - src/app/(dashboard)/analytics/page.tsx
  - src/app/(dashboard)/audit/page.tsx
  - src/app/(dashboard)/environments/page.tsx
  - src/app/(dashboard)/environments/[id]/page.tsx
  - src/app/(dashboard)/fleet/page.tsx
  - src/app/(dashboard)/pipelines/page.tsx
  - src/app/(dashboard)/pipelines/[id]/page.tsx
  - src/app/(dashboard)/pipelines/[id]/metrics/page.tsx
key_decisions: []
patterns_established:
  - "Error guard pattern: if (query.isError) return <QueryError message='...' onRetry={() => query.refetch()} /> — placed after hooks, before main JSX"
  - "Environment guard pattern: if (!selectedEnvironmentId) return <EmptyState title='Select an environment to view ...' />"
  - "Loading skeleton pattern for analytics: 4 Skeleton cards + chart + table placeholders"
observability_surfaces:
  - "none — purely presentational changes; visibility verified via grep for component imports"
duration: 12m
verification_result: passed
completed_at: 2026-03-23
blocker_discovered: false
---

# T02: Add error, loading, and empty states to core dashboard pages

**Added QueryError handling, EmptyState components, and loading skeleton to all 9 core dashboard pages — no page shows a blank screen on error, empty data, or loading.**

## What Happened

Applied the shared `EmptyState` and `QueryError` components (from T01) across all 9 core dashboard pages:

1. **Dashboard main** (`page.tsx`): Added "select environment" guard using `EmptyState` and error check on `stats` query using `QueryError`.

2. **Analytics** (`analytics/page.tsx`): Replaced inline "select environment" div with `EmptyState`, added `QueryError` for the analytics query, and added a loading skeleton (4 KPI card skeletons + chart + table).

3. **Audit** (`audit/page.tsx`): Added `QueryError` on `logsQuery` error, replaced inline empty state with `EmptyState` (preserving "No audit log entries found" text).

4. **Environments** (`environments/page.tsx`): Added `QueryError` on environments query, replaced inline empty state with `EmptyState` (preserving CTA to "Create your first environment").

5. **Environment detail** (`environments/[id]/page.tsx`): Added `QueryError` on `envQuery` error (between existing loading and not-found checks), replaced inline nodes empty state with `EmptyState` using `className="p-8"` to match original spacing.

6. **Fleet** (`fleet/page.tsx`): Added `QueryError` on `nodesQuery` error, replaced inline empty state with `EmptyState` (preserving enrollment token description).

7. **Pipelines** (`pipelines/page.tsx`): Added `QueryError` on `pipelinesQuery` error, replaced inline empty state with `EmptyState` (preserving CTA to "Create your first pipeline").

8. **Pipeline detail** (`pipelines/[id]/page.tsx`): Replaced inline error text with `QueryError` component (with retry), preserving the full-height centered layout.

9. **Pipeline metrics** (`pipelines/[id]/metrics/page.tsx`): Added `QueryError` on `pipelineQuery` error, replaced inline metrics empty state with `EmptyState` (preserving "Metrics appear after deployment" description).

All exact text and CTAs were preserved per the critical rule in the task plan.

## Verification

All 4 task-level verification checks passed:

1. `pnpm exec tsc --noEmit` — exited 0, no type errors
2. `rg 'QueryError' src/app/(dashboard)/page.tsx ...fleet ...analytics ...pipelines` — all 4 core files contain QueryError imports
3. `rg 'border-dashed'` across all 9 target files — returns 0 matches (all inline empty states replaced)
4. `rg 'Skeleton' src/app/(dashboard)/analytics/page.tsx` — confirms Skeleton is imported and used

Slice-level checks (partial — this is T02 of 4):
- `pnpm exec tsc --noEmit` exits 0 ✅
- `rg -l 'QueryError' src/app/(dashboard)/` returns 9 files ✅ (target is 15+ after T03/T04)
- `rg -l 'EmptyState' src/app/(dashboard)/` returns 8 files ✅ (target is 12+ after T03/T04)
- `rg 'border border-dashed' src/app/(dashboard)/` still returns matches in library/alerts/settings files (expected — T03/T04 will sweep those)

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | 3.3s |
| 2 | `rg 'QueryError' src/app/(dashboard)/page.tsx src/app/(dashboard)/analytics/page.tsx src/app/(dashboard)/fleet/page.tsx src/app/(dashboard)/pipelines/page.tsx` | 0 | ✅ pass | <1s |
| 3 | `rg 'border-dashed' src/app/(dashboard)/page.tsx src/app/(dashboard)/analytics/page.tsx src/app/(dashboard)/audit/page.tsx src/app/(dashboard)/environments/page.tsx src/app/(dashboard)/fleet/page.tsx src/app/(dashboard)/pipelines/page.tsx` | 1 (no matches) | ✅ pass | <1s |
| 4 | `rg 'Skeleton' src/app/(dashboard)/analytics/page.tsx` | 0 | ✅ pass | <1s |
| 5 | `rg -l 'QueryError' src/app/(dashboard)/` (9 files) | 0 | ✅ pass | <1s |
| 6 | `rg -l 'EmptyState' src/app/(dashboard)/` (8 files) | 0 | ✅ pass | <1s |

## Diagnostics

- Verify QueryError adoption: `rg -l 'QueryError' src/app/\(dashboard\)/` — should show 9 files after this task
- Verify EmptyState adoption: `rg -l 'EmptyState' src/app/\(dashboard\)/` — should show 8 files after this task
- Verify no inline patterns in target files: `rg 'border-dashed' src/app/\(dashboard\)/page.tsx src/app/\(dashboard\)/analytics/page.tsx src/app/\(dashboard\)/audit/page.tsx src/app/\(dashboard\)/environments/page.tsx src/app/\(dashboard\)/environments/\[id\]/page.tsx src/app/\(dashboard\)/fleet/page.tsx src/app/\(dashboard\)/pipelines/page.tsx src/app/\(dashboard\)/pipelines/\[id\]/page.tsx src/app/\(dashboard\)/pipelines/\[id\]/metrics/page.tsx` — should return 0 matches

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/app/(dashboard)/page.tsx` — added EmptyState environment guard + QueryError on stats query
- `src/app/(dashboard)/analytics/page.tsx` — replaced inline empty state, added QueryError + loading skeleton
- `src/app/(dashboard)/audit/page.tsx` — added QueryError on logsQuery, replaced inline empty state with EmptyState
- `src/app/(dashboard)/environments/page.tsx` — added QueryError, replaced inline empty state with EmptyState
- `src/app/(dashboard)/environments/[id]/page.tsx` — added QueryError on envQuery, replaced nodes empty state with EmptyState (p-8)
- `src/app/(dashboard)/fleet/page.tsx` — added QueryError, replaced inline empty state with EmptyState
- `src/app/(dashboard)/pipelines/page.tsx` — added QueryError, replaced inline empty state with EmptyState
- `src/app/(dashboard)/pipelines/[id]/page.tsx` — replaced inline error text with QueryError component
- `src/app/(dashboard)/pipelines/[id]/metrics/page.tsx` — added QueryError, replaced inline empty state with EmptyState
- `.gsd/milestones/M001/slices/S03/tasks/T02-PLAN.md` — added Observability Impact section (pre-flight fix)
