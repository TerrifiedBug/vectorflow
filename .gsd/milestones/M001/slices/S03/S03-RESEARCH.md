# S03: UI Consistency Sweep — Research

**Date:** 2026-03-23
**Depth:** Targeted — known patterns in the codebase, no new tech; main complexity is breadth (32 pages)

## Summary

S03 targets R005 (consistent loading/empty/error states on all dashboard pages) and R006 (general UI polish). The codebase already has well-established patterns for loading skeletons and empty states — roughly 18 pages/components use them correctly — but coverage is uneven. The biggest gap is **query error handling**: almost no page shows an error state when tRPC queries fail, so users either see a perpetual loading skeleton or silently empty data. A secondary gap is that the analytics page (502 lines, data-heavy with 4 KPI cards + chart + table) has no loading skeleton at all, and the main dashboard page has no "select an environment" prompt. The empty state pattern (`border-dashed p-12`) is consistent where it exists but is copy-pasted inline everywhere — extracting a shared `EmptyState` component would lock in consistency.

The work is mechanical but wide: ~14 pages/components need query error handling added, 1 page needs loading skeletons, a few need empty-state guards, and the inline empty-state boilerplate can be extracted to a reusable component. No API changes, no runtime behavior changes, no new dependencies.

## Recommendation

1. **Create shared UI utility components** in `src/components/`:
   - `empty-state.tsx` — reusable empty state with icon, message, optional CTA. Matches the existing `border-dashed p-12` pattern exactly.
   - `query-error.tsx` — lightweight inline query error display (icon + message + retry button). Consistent with the existing `ErrorBoundary` visual language (uses `AlertTriangle`, destructive variant).
   - `page-skeleton.tsx` — optional, but Pattern A (settings) and Pattern B (list) skeletons are repeated enough to warrant a `<PageSkeleton variant="list" />` and `<PageSkeleton variant="settings" />`.

2. **Add query error handling** to all pages that fetch data — check `query.isError` and render the shared error component. This is the highest-value fix (R005 requires "no blank white screen").

3. **Add loading skeleton** to `analytics/page.tsx` (the only data page without one).

4. **Add "select an environment" guard** to the dashboard main page (matches pattern already used by analytics, alerts, library pages).

5. **Replace inline empty-state divs** with the shared `EmptyState` component across all existing pages for consistency (R006).

6. Verify with `tsc --noEmit` and `eslint src/` after all changes.

## Implementation Landscape

### Key Files

**Shared components to create:**
- `src/components/empty-state.tsx` — new, reusable empty state (icon, title, description, optional action button/CTA)
- `src/components/query-error.tsx` — new, inline query error display (icon, message, retry callback)

**Pages needing query error handling (highest priority — R005):**
- `src/app/(dashboard)/page.tsx` — dashboard, also needs "no environment" guard
- `src/app/(dashboard)/analytics/page.tsx` — also needs loading skeleton
- `src/app/(dashboard)/audit/page.tsx`
- `src/app/(dashboard)/environments/page.tsx`
- `src/app/(dashboard)/fleet/page.tsx`
- `src/app/(dashboard)/fleet/[nodeId]/page.tsx`
- `src/app/(dashboard)/pipelines/page.tsx`
- `src/app/(dashboard)/pipelines/[id]/page.tsx`
- `src/app/(dashboard)/pipelines/[id]/metrics/page.tsx`
- `src/app/(dashboard)/library/templates/page.tsx`
- `src/app/(dashboard)/library/shared-components/page.tsx`
- `src/app/(dashboard)/library/shared-components/[id]/page.tsx`
- `src/app/(dashboard)/settings/service-accounts/page.tsx`
- `src/app/(dashboard)/alerts/_components/alert-history-section.tsx`

**Settings _components that already have loading but could use query error handling:**
- `src/app/(dashboard)/settings/_components/fleet-settings.tsx`
- `src/app/(dashboard)/settings/_components/teams-management.tsx`
- `src/app/(dashboard)/settings/_components/version-check-section.tsx`

**Pages needing empty-state replacement (R006 polish — swap inline divs with shared component):**
- All 14+ pages that currently have `border-dashed p-12` inline empty states

**Reference patterns:**
- `src/components/ui/skeleton.tsx` — existing Skeleton primitive (shadcn/ui)
- `src/components/error-boundary.tsx` — existing class-based ErrorBoundary (wraps children in layout)
- `src/components/confirm-dialog.tsx` — existing shared dialog component (good pattern reference for shared component API)

### Existing Patterns to Match

**Loading Skeleton Pattern A (settings/detail pages):**
```tsx
if (query.isLoading) {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
```

**Loading Skeleton Pattern B (list/table pages):**
```tsx
{isLoading ? (
  <div className="space-y-3">
    {Array.from({ length: 3 }).map((_, i) => (
      <Skeleton key={i} className="h-12 w-full" />
    ))}
  </div>
) : ...}
```

**Empty State Pattern (consistent across codebase):**
```tsx
<div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
  <Icon className="h-10 w-10 text-muted-foreground mb-3" /> {/* optional, some pages include icon */}
  <p className="text-muted-foreground">No items yet</p>
  <Button asChild className="mt-4" variant="outline"> {/* optional CTA */}
    <Link href="/create">Create your first item</Link>
  </Button>
</div>
```

**Mutation Error Pattern (already consistent — no changes needed):**
```tsx
onError: (error) => toast.error(error.message || "Failed to do thing")
```

### Build Order

1. **T01: Create shared components** (`empty-state.tsx`, `query-error.tsx`). These unblock all subsequent file edits. Quick to build, low risk.

2. **T02: Add error + loading + empty states to main pages** — dashboard, analytics, audit, environments, fleet, pipelines, library pages. This is the bulk of the work and directly satisfies R005. Add `query.isError` checks pointing to the shared `QueryError` component, add loading skeleton to analytics, add "select environment" guard to dashboard.

3. **T03: Add error handling to settings and alert sub-components** — fleet-settings, teams-management, version-check-section, alert sub-components. These already have loading/empty but lack query error handling.

4. **T04: Replace inline empty-state divs** with the shared `EmptyState` component across all pages. This is a mechanical find-and-replace that satisfies R006 and locks in the pattern. Should be done last so T02/T03 don't conflict.

### Verification Approach

1. `pnpm exec tsc --noEmit` — must exit 0 (R001 regression check)
2. `pnpm exec eslint src/` — must exit 0 (R008 regression check)
3. `rg 'border border-dashed' src/app/\(dashboard\)/` — should return 0 matches after T04 (all replaced with shared component) — OR a very small number if some inline uses are justified (e.g. compact `p-4` variants)
4. `rg 'QueryError\|query-error' src/app/` — should show imports in all 14+ pages that fetch data
5. `rg 'EmptyState\|empty-state' src/app/` — should show imports replacing all inline empty states
6. Manual spot-check: every dashboard page should render a proper skeleton, empty state with CTA, or error state — never a blank white screen

## Common Pitfalls

- **Over-engineering the shared components** — keep `EmptyState` and `QueryError` simple. They're thin wrappers around existing patterns, not feature-rich components. A few props (icon, title, description, action) is enough. Don't add animation, theming layers, or complex conditional rendering.

- **Breaking existing empty-state messaging** — each page has slightly different empty state text and CTAs. When replacing inline divs with `<EmptyState>`, preserve the exact text and CTA for each page. Don't homogenize messages like "No items yet" when the original says "No agents enrolled yet — generate an enrollment token to connect agents."

- **Query error retry behavior** — the retry button in `QueryError` should call `query.refetch()`. TanStack Query already has default retry logic (3 retries), so the error state only shows after all retries are exhausted. Don't add extra retry logic.

- **Dashboard page already has `ErrorBoundary`** — the layout-level `ErrorBoundary` catches render exceptions. The new `QueryError` component handles tRPC query failures (network errors, 500s, auth errors). These are complementary, not redundant.

## Constraints

- Must not change any API contracts — this is purely UI-side work
- `tsc --noEmit` and `eslint src/` must continue to exit 0 (R001, R008)
- Shared components must work with the existing shadcn/ui + Tailwind + lucide-react stack — no new dependencies
- Pages that delegate to `_components/` (alerts, settings) — error handling should be in the child components, not the wrapper pages
