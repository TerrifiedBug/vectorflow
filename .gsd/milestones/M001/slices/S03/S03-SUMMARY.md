---
id: S03
milestone: M001
title: "UI consistency sweep"
status: done
tasks_completed: 4/4
duration: ~40m
requirements_addressed: R005, R006
blocker_discovered: false
completed_at: 2026-03-23
---

# S03: UI Consistency Sweep — Summary

**Every dashboard page now has consistent loading skeletons, empty states with CTAs, and query error handling. Zero inline `border-dashed` empty state patterns remain. Two shared components (`EmptyState`, `QueryError`) are adopted across 27+ files.**

## What This Slice Delivered

Created two shared UI components and wired them into every data-fetching dashboard page:

1. **`src/components/empty-state.tsx`** — Shared `EmptyState` component accepting `icon` (LucideIcon), `title`, `description`, `action` (CTA with label + href), and `className` (merged via `cn()`). Base classes: `flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center`.

2. **`src/components/query-error.tsx`** — Shared `QueryError` component with `AlertTriangle` icon, `text-destructive` coloring, configurable `message` (defaults to "Failed to load data"), and optional `onRetry` callback that renders a retry button.

3. **Wired into 27 dashboard files** — All core pages (dashboard, analytics, audit, environments, fleet, pipelines), all library pages (templates, shared-components), all alerts sub-components, and all settings sub-components now use `QueryError` for error handling and `EmptyState` for empty data states.

4. **Loading skeleton added** to the analytics page (the only data page that lacked one).

5. **"Select environment" guard** added to the dashboard main page and environment-dependent pages using `EmptyState`.

## Files Created

- `src/components/empty-state.tsx` — shared EmptyState component
- `src/components/query-error.tsx` — shared QueryError component

## Files Modified (30 dashboard pages)

**Core pages (T02):** `page.tsx`, `analytics/page.tsx`, `audit/page.tsx`, `environments/page.tsx`, `environments/[id]/page.tsx`, `fleet/page.tsx`, `pipelines/page.tsx`, `pipelines/[id]/page.tsx`, `pipelines/[id]/metrics/page.tsx`

**Alerts & library (T03):** `alerts/page.tsx`, `alerts/_components/alert-history-section.tsx`, `alerts/_components/alert-rules-section.tsx`, `alerts/_components/notification-channels-section.tsx`, `alerts/_components/webhooks-section.tsx`, `library/templates/page.tsx`, `library/shared-components/page.tsx`, `library/shared-components/[id]/page.tsx`, `library/shared-components/new/page.tsx`

**Settings (T04):** `settings/_components/fleet-settings.tsx`, `settings/_components/teams-management.tsx`, `settings/_components/version-check-section.tsx`, `settings/_components/scim-settings.tsx`, `settings/_components/audit-shipping-section.tsx`, `settings/_components/backup-settings.tsx`, `settings/_components/team-settings.tsx`, `settings/_components/users-settings.tsx`, `settings/_components/ai-settings.tsx`, `settings/_components/auth-settings.tsx`, `settings/service-accounts/page.tsx`, `fleet/[nodeId]/page.tsx`

## Patterns Established

### Error guard pattern
```tsx
if (query.isError) return <QueryError message="Failed to load X" onRetry={() => query.refetch()} />;
```
Placed after hooks, before main JSX. Used in all 27 data-fetching pages.

### Environment guard pattern
```tsx
if (!selectedEnvironmentId) return <EmptyState title="Select an environment to view X." />;
```
With compact variant `className="p-4 text-sm"` when nested inside existing padding containers.

### Error guard placement variations
- **Standard**: early return before `isLoading` check (most components)
- **Inline ternary**: inside `CardContent` when component renders within a Card wrapper (version-check-section)
- **Before hide-when-empty**: placed before conditional section hiding so errors are always visible (webhooks-section)
- **Before main return**: when no top-level `isLoading` early return exists (audit-shipping, backup-settings)

## Verification Results

| # | Check | Result | Detail |
|---|-------|--------|--------|
| 1 | `pnpm exec tsc --noEmit` | ✅ exit 0 | No type errors |
| 2 | `pnpm exec eslint src/` | ✅ exit 0 | No lint errors |
| 3 | Shared components exist | ✅ | Both `empty-state.tsx` and `query-error.tsx` present |
| 4 | Zero inline `border-dashed` | ✅ | `rg 'border border-dashed' src/app/(dashboard)/` → 0 matches |
| 5 | QueryError adoption | ✅ | 27 files (threshold: 15+) |
| 6 | EmptyState adoption | ✅ | 17 files (threshold: 12+) |

## What Downstream Slices Should Know

- **S04 (tests)**: `EmptyState` and `QueryError` are purely presentational — no side effects, no data fetching. They accept simple props (`icon`, `title`, `description`, `action`, `onRetry`). Testing them is straightforward render-and-assert.
- **S05 (performance)**: No bundle impact concerns — both components use only existing imports (`lucide-react`, `@/components/ui/button`, `next/link`, `@/lib/utils`). No new dependencies added.
- **Future UI work**: Import `EmptyState` from `@/components/empty-state` and `QueryError` from `@/components/query-error`. Follow the error guard pattern established here. Never add inline `border-dashed` empty states — always use the shared component.

## Diagnostic Shortcuts

- Verify adoption coverage: `rg -l 'QueryError' src/app/\(dashboard\)/` and `rg -l 'EmptyState' src/app/\(dashboard\)/`
- Verify no regressions: `rg 'border border-dashed' src/app/\(dashboard\)/` should return 0 matches
- View component APIs: `rg 'export function' src/components/empty-state.tsx src/components/query-error.tsx`

## Known Issues

None.
