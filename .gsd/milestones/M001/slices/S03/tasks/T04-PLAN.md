---
estimated_steps: 4
estimated_files: 11
skills_used: []
---

# T04: Add error handling to settings sub-components and run final verification

**Slice:** S03 — UI Consistency Sweep
**Milestone:** M001

## Description

All settings sub-components already have loading skeleton guards but lack query error handling. This task adds `isError` checks to each, then runs the full verification suite to confirm R005 and R006 are satisfied across the entire dashboard.

The changes are highly mechanical: each file gets an import of `QueryError` and a 3-line `if (query.isError)` guard inserted before the existing `if (query.isLoading)` guard.

## Steps

1. **Add error handling to 11 settings files.** For each file, add:
   - `import { QueryError } from "@/components/query-error";`
   - An `isError` guard placed **before** the existing `isLoading` guard, using the primary query for that component:
     - `fleet-settings.tsx`: `if (settingsQuery.isError) return <QueryError message="Failed to load fleet settings" onRetry={() => settingsQuery.refetch()} />`
     - `teams-management.tsx`: `if (teamsQuery.isError) return <QueryError message="Failed to load teams" onRetry={() => teamsQuery.refetch()} />`
     - `version-check-section.tsx`: Check `versionQuery.isError` — this component renders inside a Card, so the QueryError should replace the CardContent body, not return from the component. Use: `{versionQuery.isError ? <QueryError message="Failed to check version" onRetry={() => versionQuery.refetch()} /> : versionQuery.isLoading ? ... : ...}`
     - `scim-settings.tsx`: `if (settingsQuery.isError) return <QueryError message="Failed to load SCIM settings" onRetry={() => settingsQuery.refetch()} />`
     - `audit-shipping-section.tsx`: `if (systemPipelineQuery.isError) return <QueryError message="Failed to load audit shipping settings" onRetry={() => systemPipelineQuery.refetch()} />`
     - `backup-settings.tsx`: `if (settingsQuery.isError) return <QueryError message="Failed to load backup settings" onRetry={() => settingsQuery.refetch()} />`
     - `team-settings.tsx`: `if (teamQuery.isError) return <QueryError message="Failed to load team settings" onRetry={() => teamQuery.refetch()} />`
     - `users-settings.tsx`: `if (usersQuery.isError) return <QueryError message="Failed to load users" onRetry={() => usersQuery.refetch()} />`
     - `ai-settings.tsx`: `if (configQuery.isError) return <QueryError message="Failed to load AI settings" onRetry={() => configQuery.refetch()} />`
     - `auth-settings.tsx`: `if (settingsQuery.isError) return <QueryError message="Failed to load auth settings" onRetry={() => settingsQuery.refetch()} />`
     - `service-accounts/page.tsx`: `if (serviceAccountsQuery.isError) return <QueryError message="Failed to load service accounts" onRetry={() => serviceAccountsQuery.refetch()} />`

2. **Run `pnpm exec tsc --noEmit`** — must exit 0.

3. **Run `pnpm exec eslint src/`** — must exit 0.

4. **Run final verification sweep:**
   - `rg 'border border-dashed' src/app/\(dashboard\)/` — must return 0 matches (all inline empty states replaced by T02/T03)
   - `rg -l 'QueryError' src/app/\(dashboard\)/` — count should be 20+ files
   - `rg -l 'EmptyState' src/app/\(dashboard\)/` — count should be 12+ files
   - If any `border-dashed` matches remain in files not yet touched, replace them with `EmptyState`.

## Must-Haves

- [ ] All 11 settings-related files have `isError` guard using `QueryError`
- [ ] Error guard is placed before the `isLoading` guard in each file
- [ ] `version-check-section.tsx` handles error inline (inside Card) rather than returning early
- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm exec eslint src/` exits 0
- [ ] `rg 'border border-dashed' src/app/\(dashboard\)/` returns 0 matches across entire dashboard

## Verification

- `pnpm exec tsc --noEmit` exits 0
- `pnpm exec eslint src/` exits 0
- `rg 'border border-dashed' src/app/\(dashboard\)/` returns 0 matches
- `rg -c 'QueryError' src/app/\(dashboard\)/ | wc -l` shows 20+ files with QueryError
- `rg -c 'EmptyState' src/app/\(dashboard\)/ | wc -l` shows 12+ files with EmptyState

## Inputs

- `src/components/query-error.tsx` — shared QueryError component (created in T01)
- `src/app/(dashboard)/settings/_components/fleet-settings.tsx` — fleet settings
- `src/app/(dashboard)/settings/_components/teams-management.tsx` — teams list
- `src/app/(dashboard)/settings/_components/version-check-section.tsx` — version check
- `src/app/(dashboard)/settings/_components/scim-settings.tsx` — SCIM settings
- `src/app/(dashboard)/settings/_components/audit-shipping-section.tsx` — audit shipping
- `src/app/(dashboard)/settings/_components/backup-settings.tsx` — backup settings
- `src/app/(dashboard)/settings/_components/team-settings.tsx` — team settings
- `src/app/(dashboard)/settings/_components/users-settings.tsx` — users management
- `src/app/(dashboard)/settings/_components/ai-settings.tsx` — AI settings
- `src/app/(dashboard)/settings/_components/auth-settings.tsx` — auth settings
- `src/app/(dashboard)/settings/service-accounts/page.tsx` — service accounts

## Expected Output

- `src/app/(dashboard)/settings/_components/fleet-settings.tsx` — error handling added
- `src/app/(dashboard)/settings/_components/teams-management.tsx` — error handling added
- `src/app/(dashboard)/settings/_components/version-check-section.tsx` — error handling added
- `src/app/(dashboard)/settings/_components/scim-settings.tsx` — error handling added
- `src/app/(dashboard)/settings/_components/audit-shipping-section.tsx` — error handling added
- `src/app/(dashboard)/settings/_components/backup-settings.tsx` — error handling added
- `src/app/(dashboard)/settings/_components/team-settings.tsx` — error handling added
- `src/app/(dashboard)/settings/_components/users-settings.tsx` — error handling added
- `src/app/(dashboard)/settings/_components/ai-settings.tsx` — error handling added
- `src/app/(dashboard)/settings/_components/auth-settings.tsx` — error handling added
- `src/app/(dashboard)/settings/service-accounts/page.tsx` — error handling added
