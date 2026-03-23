---
id: T03
parent: S03
milestone: M001
provides:
  - QueryError error handling on 4 alerts sub-components and 3 library data-fetching pages
  - EmptyState component wired into alerts page, 3 alerts sub-components, and all 4 library pages
  - All inline border-dashed empty states removed from alerts/ and library/ directories
key_files:
  - src/app/(dashboard)/alerts/page.tsx
  - src/app/(dashboard)/alerts/_components/alert-history-section.tsx
  - src/app/(dashboard)/alerts/_components/alert-rules-section.tsx
  - src/app/(dashboard)/alerts/_components/notification-channels-section.tsx
  - src/app/(dashboard)/alerts/_components/webhooks-section.tsx
  - src/app/(dashboard)/library/templates/page.tsx
  - src/app/(dashboard)/library/shared-components/page.tsx
  - src/app/(dashboard)/library/shared-components/[id]/page.tsx
  - src/app/(dashboard)/library/shared-components/new/page.tsx
key_decisions: []
patterns_established:
  - "Webhooks error guard placed before the hide-when-empty early return to ensure errors are always visible"
  - "Compact p-4 text-sm className override on EmptyState for environment guards inside existing padding containers"
observability_surfaces:
  - "none — purely presentational changes; visibility verified via grep for component imports"
duration: 8m
verification_result: passed
completed_at: 2026-03-23
blocker_discovered: false
---

# T03: Add error and empty states to library and alerts components

**Added QueryError handling and EmptyState components to all 9 alerts/library files — no page shows a blank screen on error, empty data, or missing environment selection.**

## What Happened

Applied the shared `EmptyState` and `QueryError` components (from T01) across 5 alerts files and 4 library files:

**Alerts pages (5 files):**

1. **alerts/page.tsx**: Replaced inline `border-dashed` environment guard div with `<EmptyState title="Select an environment to manage alerts." />`.

2. **alert-history-section.tsx**: Added `QueryError` error guard on `eventsQuery` (before loading ternary). Replaced inline empty state with `<EmptyState title="No alert events yet" description="Alert events will appear here when rules are triggered." />`.

3. **alert-rules-section.tsx**: Added `QueryError` error guard on `rulesQuery`. Replaced inline empty state with `<EmptyState title="No alert rules configured" description="Create an alert rule to monitor metrics and receive notifications." />`.

4. **notification-channels-section.tsx**: Added `QueryError` error guard on `channelsQuery`. Replaced inline empty state with `<EmptyState title="No notification channels configured" description="Add a notification channel to receive alerts via Slack, Email, PagerDuty, or Webhook." />`.

5. **webhooks-section.tsx**: Added `QueryError` error guard on `webhooksQuery` — placed before the hide-when-empty early return so errors are always visible even when the section would normally be hidden.

**Library pages (4 files):**

6. **library/templates/page.tsx**: Added `QueryError` on `templatesQuery`. Replaced compact environment guard with `<EmptyState className="p-4 text-sm" />`. Replaced `p-12` empty state with `<EmptyState icon={Terminal} />` (preserving Terminal icon).

7. **library/shared-components/page.tsx**: Added `QueryError` on `componentsQuery`. Replaced environment guard with `<EmptyState className="p-4 text-sm" />`. Replaced empty state with `<EmptyState icon={Link2} />` (preserving Link2 icon and conditional text).

8. **library/shared-components/[id]/page.tsx**: Added `QueryError` on `componentQuery` between loading and not-found checks. Replaced environment guard and "not found" state with `<EmptyState className="p-4 text-sm" />`.

9. **library/shared-components/new/page.tsx**: Replaced environment guard with `<EmptyState className="p-4 text-sm" />`. Replaced "No components match your search" with `<EmptyState title="No components match your search." />`.

All exact text, CTAs, and icons were preserved per the critical rule.

## Verification

All task-level and applicable slice-level checks passed:

1. `pnpm exec tsc --noEmit` — exited 0, no type errors
2. `rg 'border-dashed' src/app/(dashboard)/alerts/ src/app/(dashboard)/library/` — exit code 1 (0 matches, all inline patterns removed)
3. `rg -l 'QueryError'` across alerts _components and library data pages — all 7 data-fetching files contain QueryError
4. `rg -l 'QueryError' src/app/(dashboard)/` — 16 files total (above 15+ threshold)
5. `rg -l 'EmptyState' src/app/(dashboard)/` — 16 files total (above 12+ threshold)
6. `rg -l 'border border-dashed' src/app/(dashboard)/` — only 1 file remains (fleet/[nodeId]/page.tsx, in T04 scope)

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | 3.3s |
| 2 | `rg 'border-dashed' src/app/(dashboard)/alerts/ src/app/(dashboard)/library/` | 1 (no matches) | ✅ pass | <1s |
| 3 | `rg -l 'QueryError' src/app/(dashboard)/alerts/_components/ src/app/(dashboard)/library/templates/page.tsx src/app/(dashboard)/library/shared-components/page.tsx src/app/(dashboard)/library/shared-components/[id]/page.tsx` | 0 (7 files) | ✅ pass | <1s |
| 4 | `rg -l 'QueryError' src/app/(dashboard)/` (16 files) | 0 | ✅ pass | <1s |
| 5 | `rg -l 'EmptyState' src/app/(dashboard)/` (16 files) | 0 | ✅ pass | <1s |
| 6 | `rg -l 'border border-dashed' src/app/(dashboard)/` (1 file: fleet/[nodeId]) | 0 | ✅ pass | <1s |

## Diagnostics

- Verify QueryError adoption in alerts/library: `rg -l 'QueryError' src/app/\(dashboard\)/alerts/ src/app/\(dashboard\)/library/`
- Verify EmptyState adoption in alerts/library: `rg -l 'EmptyState' src/app/\(dashboard\)/alerts/ src/app/\(dashboard\)/library/`
- Verify no inline patterns remain in alerts/library: `rg 'border-dashed' src/app/\(dashboard\)/alerts/ src/app/\(dashboard\)/library/` — should return 0 matches
- After T04, verify full sweep: `rg 'border border-dashed' src/app/\(dashboard\)/` should return 0 matches

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/app/(dashboard)/alerts/page.tsx` — replaced inline environment guard with EmptyState component
- `src/app/(dashboard)/alerts/_components/alert-history-section.tsx` — added QueryError error handling + replaced inline empty state with EmptyState
- `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx` — added QueryError error handling + replaced inline empty state with EmptyState
- `src/app/(dashboard)/alerts/_components/notification-channels-section.tsx` — added QueryError error handling + replaced inline empty state with EmptyState
- `src/app/(dashboard)/alerts/_components/webhooks-section.tsx` — added QueryError error handling before hide-when-empty check
- `src/app/(dashboard)/library/templates/page.tsx` — added QueryError + replaced environment guard and empty state with EmptyState (Terminal icon)
- `src/app/(dashboard)/library/shared-components/page.tsx` — added QueryError + replaced environment guard and empty state with EmptyState (Link2 icon)
- `src/app/(dashboard)/library/shared-components/[id]/page.tsx` — added QueryError + replaced environment guard and not-found state with EmptyState
- `src/app/(dashboard)/library/shared-components/new/page.tsx` — replaced environment guard and search-empty state with EmptyState
- `.gsd/milestones/M001/slices/S03/tasks/T03-PLAN.md` — added Observability Impact section (pre-flight fix)
