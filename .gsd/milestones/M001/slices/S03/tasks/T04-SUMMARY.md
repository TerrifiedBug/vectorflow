---
id: T04
parent: S03
milestone: M001
provides:
  - QueryError error handling on all 11 settings sub-components and service-accounts page
  - All inline border-dashed empty states replaced across entire dashboard (0 remaining)
  - Full slice verification passing — tsc, eslint, QueryError/EmptyState coverage thresholds met
key_files:
  - src/app/(dashboard)/settings/_components/fleet-settings.tsx
  - src/app/(dashboard)/settings/_components/teams-management.tsx
  - src/app/(dashboard)/settings/_components/version-check-section.tsx
  - src/app/(dashboard)/settings/_components/scim-settings.tsx
  - src/app/(dashboard)/settings/_components/audit-shipping-section.tsx
  - src/app/(dashboard)/settings/_components/backup-settings.tsx
  - src/app/(dashboard)/settings/_components/team-settings.tsx
  - src/app/(dashboard)/settings/_components/users-settings.tsx
  - src/app/(dashboard)/settings/_components/ai-settings.tsx
  - src/app/(dashboard)/settings/_components/auth-settings.tsx
  - src/app/(dashboard)/settings/service-accounts/page.tsx
  - src/app/(dashboard)/fleet/[nodeId]/page.tsx
key_decisions: []
patterns_established:
  - "version-check-section uses inline ternary error handling inside CardContent (not early return) because it renders within a Card wrapper"
  - "audit-shipping and backup-settings place error guard before the main return since they lack a top-level isLoading early return"
observability_surfaces:
  - "none — purely presentational changes; visibility verified via grep for component imports across dashboard pages"
duration: 12m
verification_result: passed
completed_at: 2026-03-23
blocker_discovered: false
---

# T04: Add error handling to settings sub-components and verify full sweep

**Added QueryError handling to all 11 settings files and 2 EmptyState replacements in fleet/[nodeId], completing the UI consistency sweep with zero inline empty states remaining.**

## What Happened

Added `QueryError` import and `isError` guard to all 11 settings sub-components:

1. **fleet-settings.tsx**: `settingsQuery.isError` guard before `isLoading` — early return with retry.
2. **teams-management.tsx**: `teamsQuery.isError` guard before `isLoading` — early return with retry.
3. **version-check-section.tsx**: `versionQuery.isError` handled **inline** inside `CardContent` ternary (error → loading → content), since component renders within a Card wrapper.
4. **scim-settings.tsx**: `settingsQuery.isError` guard before `isLoading` — early return with retry.
5. **audit-shipping-section.tsx**: `systemPipelineQuery.isError` guard before the main return (no top-level `isLoading` early return exists).
6. **backup-settings.tsx**: `settingsQuery.isError` guard before the main return (no top-level `isLoading` early return exists).
7. **team-settings.tsx**: `teamQuery.isError` guard before `isLoading` — early return with retry.
8. **users-settings.tsx**: `usersQuery.isError` guard before `isLoading` — early return with retry.
9. **ai-settings.tsx**: `configQuery.isError` guard before `isLoading` in wrapper `AiSettings` component — early return with retry.
10. **auth-settings.tsx**: `settingsQuery.isError` guard before `isLoading` — early return with retry.
11. **service-accounts/page.tsx**: `serviceAccountsQuery.isError` guard before main return — early return with retry.

Additionally, replaced the last 2 inline `border-dashed` empty states in `fleet/[nodeId]/page.tsx`:
- "Node not found" → `<EmptyState title="Node not found" />`
- "No pipeline metrics yet" → `<EmptyState title="No pipeline metrics yet" description="..." />`

## Verification

All slice-level and task-level checks pass:

1. `pnpm exec tsc --noEmit` — exit 0
2. `pnpm exec eslint src/` — exit 0
3. `rg 'border border-dashed' src/app/(dashboard)/` — 0 matches (all inline patterns replaced)
4. `rg -l 'QueryError' src/app/(dashboard)/` — 27 files (above 20+ target)
5. `rg -l 'EmptyState' src/app/(dashboard)/` — 17 files (above 12+ target)
6. `test -f src/components/empty-state.tsx && test -f src/components/query-error.tsx` — both exist

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | 8.6s |
| 2 | `pnpm exec eslint src/` | 0 | ✅ pass | 8.6s |
| 3 | `test -f src/components/empty-state.tsx && test -f src/components/query-error.tsx` | 0 | ✅ pass | <1s |
| 4 | `rg 'border border-dashed' src/app/(dashboard)/` | 1 (no matches) | ✅ pass | <1s |
| 5 | `rg -l 'QueryError' src/app/(dashboard)/' \| wc -l` | 0 (27 files) | ✅ pass | <1s |
| 6 | `rg -l 'EmptyState' src/app/(dashboard)/' \| wc -l` | 0 (17 files) | ✅ pass | <1s |

## Diagnostics

- Verify QueryError adoption in settings: `rg -l 'QueryError' src/app/\(dashboard\)/settings/`
- Verify no inline patterns remain anywhere: `rg 'border border-dashed' src/app/\(dashboard\)/` — should return 0 matches
- Full coverage check: `rg -l 'QueryError' src/app/\(dashboard\)/` — should show 27+ files
- Full coverage check: `rg -l 'EmptyState' src/app/\(dashboard\)/` — should show 17+ files

## Deviations

- **fleet/[nodeId]/page.tsx**: Replaced 2 remaining `border-dashed` inline empty states with `EmptyState` component (not listed in the original T04 plan, but required to satisfy the slice verification check of 0 remaining inline patterns). T03 had identified this file as the last holdout.

## Known Issues

None.

## Files Created/Modified

- `src/app/(dashboard)/settings/_components/fleet-settings.tsx` — added QueryError import + isError guard
- `src/app/(dashboard)/settings/_components/teams-management.tsx` — added QueryError import + isError guard
- `src/app/(dashboard)/settings/_components/version-check-section.tsx` — added QueryError import + inline error handling in CardContent
- `src/app/(dashboard)/settings/_components/scim-settings.tsx` — added QueryError import + isError guard
- `src/app/(dashboard)/settings/_components/audit-shipping-section.tsx` — added QueryError import + isError guard
- `src/app/(dashboard)/settings/_components/backup-settings.tsx` — added QueryError import + isError guard
- `src/app/(dashboard)/settings/_components/team-settings.tsx` — added QueryError import + isError guard
- `src/app/(dashboard)/settings/_components/users-settings.tsx` — added QueryError import + isError guard
- `src/app/(dashboard)/settings/_components/ai-settings.tsx` — added QueryError import + isError guard
- `src/app/(dashboard)/settings/_components/auth-settings.tsx` — added QueryError import + isError guard
- `src/app/(dashboard)/settings/service-accounts/page.tsx` — added QueryError import + isError guard
- `src/app/(dashboard)/fleet/[nodeId]/page.tsx` — replaced 2 inline border-dashed empty states with EmptyState component
