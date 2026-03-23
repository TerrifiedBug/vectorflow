---
id: T01
parent: S03
milestone: M001
provides:
  - EmptyState shared component (src/components/empty-state.tsx)
  - QueryError shared component (src/components/query-error.tsx)
key_files:
  - src/components/empty-state.tsx
  - src/components/query-error.tsx
key_decisions: []
patterns_established:
  - "EmptyState wrapper: icon, title, description, action (CTA link), className override via cn()"
  - "QueryError wrapper: AlertTriangle icon with text-destructive, optional retry callback"
  - "Both components share the base div classes: flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center"
observability_surfaces:
  - "none — purely presentational components"
duration: 8m
verification_result: passed
completed_at: 2026-03-23
blocker_discovered: false
---

# T01: Create shared EmptyState and QueryError components

**Created EmptyState and QueryError shared components matching existing dashboard visual patterns for border-dashed empty states and inline query error display with retry.**

## What Happened

Created two shared React components that all subsequent S03 tasks will use to replace inline patterns across ~25 dashboard pages:

1. **`EmptyState`** — accepts `icon` (LucideIcon), `title`, `description`, `action` (CTA with label + href), and `className` (merged via `cn()` for caller overrides). The base classes exactly match the existing `border-dashed p-12` inline pattern found in 16+ dashboard files.

2. **`QueryError`** — accepts `message` (defaults to "Failed to load data") and `onRetry` callback. Uses `AlertTriangle` icon with `text-destructive` coloring, matching the ErrorBoundary visual language. The retry button renders conditionally when `onRetry` is provided.

Both components use only existing imports (`lucide-react`, `@/components/ui/button`, `next/link`, `@/lib/utils`) — no new dependencies.

## Verification

All 4 task-level checks passed:

1. `pnpm exec tsc --noEmit` — exited 0, no type errors
2. `test -f src/components/empty-state.tsx && test -f src/components/query-error.tsx` — both files exist
3. `rg 'export function EmptyState' src/components/empty-state.tsx` — confirmed named export
4. `rg 'export function QueryError' src/components/query-error.tsx` — confirmed named export

Slice-level checks (partial — this is T01 of 4):
- `pnpm exec tsc --noEmit` exits 0 ✅
- `test -f src/components/empty-state.tsx && test -f src/components/query-error.tsx` ✅
- Remaining slice checks (eslint, border-dashed grep, import coverage) are expected to pass after T02–T04 wire the components into dashboard pages.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | 10.0s |
| 2 | `test -f src/components/empty-state.tsx && test -f src/components/query-error.tsx` | 0 | ✅ pass | <1s |
| 3 | `rg 'export function EmptyState' src/components/empty-state.tsx` | 0 | ✅ pass | <1s |
| 4 | `rg 'export function QueryError' src/components/query-error.tsx` | 0 | ✅ pass | <1s |

## Diagnostics

- Verify component existence: `test -f src/components/empty-state.tsx && test -f src/components/query-error.tsx`
- After downstream tasks, verify adoption: `rg -l 'EmptyState' src/app/\(dashboard\)/` and `rg -l 'QueryError' src/app/\(dashboard\)/`
- Verify no inline patterns remain: `rg 'border border-dashed' src/app/\(dashboard\)/` should return 0 matches after T04

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/components/empty-state.tsx` — new shared EmptyState component with icon, title, description, action, and className props
- `src/components/query-error.tsx` — new shared QueryError component with AlertTriangle icon, error message, and optional retry button
- `.gsd/milestones/M001/slices/S03/S03-PLAN.md` — added Observability / Diagnostics section (pre-flight fix)
- `.gsd/milestones/M001/slices/S03/tasks/T01-PLAN.md` — added Observability Impact section (pre-flight fix)
