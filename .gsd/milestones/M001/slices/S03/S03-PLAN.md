# S03: UI Consistency Sweep

**Goal:** Every dashboard page has consistent loading skeletons, empty states with CTAs, and query error handling — no page shows a blank white screen during loading, on empty data, or when a query fails.
**Demo:** Navigate to any dashboard page with no data → see an empty state with a helpful message and CTA. Disconnect network → existing pages show an inline error with a retry button. Loading states show skeletons, not blank space.

## Must-Haves

- Shared `EmptyState` component replaces all inline `border-dashed p-12` empty state divs across dashboard pages
- Shared `QueryError` component provides inline error display with retry for failed tRPC queries
- All data-fetching dashboard pages check `query.isError` and render `QueryError` with `query.refetch`
- Analytics page has a loading skeleton (currently the only data page without one)
- Dashboard main page has a "select an environment" guard when no environment is selected
- `tsc --noEmit` exits 0 (R001 regression check)
- `eslint src/` exits 0 (R008 regression check)

## Proof Level

- This slice proves: integration (UI components wired into all dashboard pages)
- Real runtime required: no (static analysis + grep verification sufficient; visual spot-check is UAT)
- Human/UAT required: yes (visual spot-check that pages look correct)

## Verification

- `pnpm exec tsc --noEmit` exits 0
- `pnpm exec eslint src/` exits 0
- `test -f src/components/empty-state.tsx && test -f src/components/query-error.tsx` — shared components exist
- `rg 'border border-dashed' src/app/\(dashboard\)/` returns 0 matches (all inline empty states replaced)
- `rg -l 'QueryError' src/app/\(dashboard\)/` returns 15+ files (error handling wired into all data pages)
- `rg -l 'EmptyState' src/app/\(dashboard\)/` returns 12+ files (shared component used across pages)

## Observability / Diagnostics

- **Runtime signals**: `EmptyState` and `QueryError` are purely presentational — no runtime telemetry. Visibility is verified via grep for component imports across dashboard pages.
- **Inspection surfaces**: `rg -l 'QueryError' src/app/\(dashboard\)/` and `rg -l 'EmptyState' src/app/\(dashboard\)/` show adoption coverage. `rg 'border border-dashed' src/app/\(dashboard\)/` should return 0 matches when the sweep is complete (all inline patterns replaced).
- **Failure visibility**: When a tRPC query fails, the `QueryError` component renders an inline error with a retry button — the user sees "Failed to load data" instead of a blank screen. No server-side logging is added by these components.
- **Redaction constraints**: None — these components render only UI labels and icons, no user data or secrets.

## Integration Closure

- Upstream surfaces consumed: `src/components/ui/skeleton.tsx` (existing shadcn primitive), `src/components/error-boundary.tsx` (visual language reference for error display)
- New wiring introduced in this slice: `src/components/empty-state.tsx` and `src/components/query-error.tsx` imported by ~25 dashboard page files
- What remains before the milestone is truly usable end-to-end: S04 (tests), S05 (performance audit)

## Tasks

- [x] **T01: Create shared EmptyState and QueryError components** `est:30m`
  - Why: All subsequent tasks need these components to replace inline patterns and add error handling. Creating them first unblocks everything.
  - Files: `src/components/empty-state.tsx`, `src/components/query-error.tsx`
  - Do: Create `EmptyState` (icon, title, description, optional action button — matches existing `border-dashed p-12` pattern exactly) and `QueryError` (AlertTriangle icon, error message, retry button — consistent with ErrorBoundary visual language). Use existing shadcn/ui components (Button, Card). No new dependencies.
  - Verify: `pnpm exec tsc --noEmit` exits 0 and both files exist
  - Done when: Both components compile, export default-style React components with typed props, and match the existing visual patterns

- [x] **T02: Add error, loading, and empty states to core dashboard pages** `est:1h`
  - Why: The highest-traffic pages (dashboard, analytics, audit, environments, fleet, pipelines) currently have no query error handling. Analytics has no loading skeleton. Dashboard has no "select environment" guard. This task delivers the most visible R005 improvements.
  - Files: `src/app/(dashboard)/page.tsx`, `src/app/(dashboard)/analytics/page.tsx`, `src/app/(dashboard)/audit/page.tsx`, `src/app/(dashboard)/environments/page.tsx`, `src/app/(dashboard)/environments/[id]/page.tsx`, `src/app/(dashboard)/fleet/page.tsx`, `src/app/(dashboard)/pipelines/page.tsx`, `src/app/(dashboard)/pipelines/[id]/page.tsx`, `src/app/(dashboard)/pipelines/[id]/metrics/page.tsx`
  - Do: For each page: (1) import `QueryError` and `EmptyState`, (2) add `isError` check rendering `QueryError` with `query.refetch`, (3) replace inline `border-dashed` empty states with `EmptyState` component (preserve exact text and CTAs), (4) add loading skeleton to analytics page, (5) add "select an environment" guard to dashboard page. Match existing patterns in the codebase.
  - Verify: `pnpm exec tsc --noEmit` exits 0; `rg 'QueryError' src/app/\(dashboard\)/page.tsx src/app/\(dashboard\)/analytics/page.tsx src/app/\(dashboard\)/pipelines/page.tsx` shows imports in all three
  - Done when: All 9 core pages have error handling, inline empty states are replaced with shared component, analytics has loading skeleton, dashboard has environment guard

- [x] **T03: Add error and empty states to library and alerts components** `est:45m`
  - Why: Library pages and alerts sub-components are data-heavy sections that need the same error/empty treatment. Alerts sub-components already have loading but lack error handling. Library pages need both.
  - Files: `src/app/(dashboard)/library/templates/page.tsx`, `src/app/(dashboard)/library/shared-components/page.tsx`, `src/app/(dashboard)/library/shared-components/[id]/page.tsx`, `src/app/(dashboard)/library/shared-components/new/page.tsx`, `src/app/(dashboard)/alerts/_components/alert-history-section.tsx`, `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx`, `src/app/(dashboard)/alerts/_components/notification-channels-section.tsx`, `src/app/(dashboard)/alerts/_components/webhooks-section.tsx`, `src/app/(dashboard)/alerts/page.tsx`
  - Do: For each file: (1) import `QueryError` and `EmptyState`, (2) add `isError` check rendering `QueryError`, (3) replace inline `border-dashed` empty state divs with shared `EmptyState` component (preserve each page's specific text and CTAs). For alerts sub-components, add error check before the existing loading check.
  - Verify: `pnpm exec tsc --noEmit` exits 0; `rg 'QueryError' src/app/\(dashboard\)/library/ src/app/\(dashboard\)/alerts/` shows imports
  - Done when: All 7 files have error handling and use shared EmptyState component

- [x] **T04: Add error handling to settings sub-components and verify full sweep** `est:45m`
  - Why: Settings sub-components (11 files including auth-settings) already have loading skeletons but no query error handling. This task completes the sweep and runs final verification to confirm R005/R006 are satisfied.
  - Files: `src/app/(dashboard)/settings/_components/fleet-settings.tsx`, `src/app/(dashboard)/settings/_components/teams-management.tsx`, `src/app/(dashboard)/settings/_components/version-check-section.tsx`, `src/app/(dashboard)/settings/_components/scim-settings.tsx`, `src/app/(dashboard)/settings/_components/audit-shipping-section.tsx`, `src/app/(dashboard)/settings/_components/backup-settings.tsx`, `src/app/(dashboard)/settings/_components/team-settings.tsx`, `src/app/(dashboard)/settings/_components/users-settings.tsx`, `src/app/(dashboard)/settings/_components/ai-settings.tsx`, `src/app/(dashboard)/settings/_components/auth-settings.tsx`, `src/app/(dashboard)/settings/service-accounts/page.tsx`
  - Do: For each file: (1) import `QueryError`, (2) add `isError` check before the existing `isLoading` check — render `QueryError` with the query's refetch function. Service-accounts page also needs EmptyState replacement. After all edits, run the full verification suite: `tsc --noEmit`, `eslint src/`, grep for remaining `border-dashed` and confirm zero matches, grep for `QueryError` and `EmptyState` imports to confirm coverage.
  - Verify: `pnpm exec tsc --noEmit` exits 0; `pnpm exec eslint src/` exits 0; `rg 'border border-dashed' src/app/\(dashboard\)/` returns 0 matches; `rg -c 'QueryError' src/app/\(dashboard\)/` shows 15+ files
  - Done when: All settings components have error handling, zero inline empty states remain, `tsc` and `eslint` pass, grep verification confirms full coverage

## Files Likely Touched

- `src/components/empty-state.tsx` (new)
- `src/components/query-error.tsx` (new)
- `src/app/(dashboard)/page.tsx`
- `src/app/(dashboard)/analytics/page.tsx`
- `src/app/(dashboard)/audit/page.tsx`
- `src/app/(dashboard)/environments/page.tsx`
- `src/app/(dashboard)/environments/[id]/page.tsx`
- `src/app/(dashboard)/fleet/page.tsx`
- `src/app/(dashboard)/pipelines/page.tsx`
- `src/app/(dashboard)/pipelines/[id]/page.tsx`
- `src/app/(dashboard)/pipelines/[id]/metrics/page.tsx`
- `src/app/(dashboard)/library/templates/page.tsx`
- `src/app/(dashboard)/library/shared-components/page.tsx`
- `src/app/(dashboard)/library/shared-components/[id]/page.tsx`
- `src/app/(dashboard)/library/shared-components/new/page.tsx`
- `src/app/(dashboard)/alerts/_components/alert-history-section.tsx`
- `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx`
- `src/app/(dashboard)/alerts/_components/notification-channels-section.tsx`
- `src/app/(dashboard)/alerts/_components/webhooks-section.tsx`
- `src/app/(dashboard)/settings/_components/fleet-settings.tsx`
- `src/app/(dashboard)/settings/_components/teams-management.tsx`
- `src/app/(dashboard)/settings/_components/version-check-section.tsx`
- `src/app/(dashboard)/settings/_components/scim-settings.tsx`
- `src/app/(dashboard)/settings/_components/audit-shipping-section.tsx`
- `src/app/(dashboard)/settings/_components/backup-settings.tsx`
- `src/app/(dashboard)/settings/_components/team-settings.tsx`
- `src/app/(dashboard)/settings/_components/users-settings.tsx`
- `src/app/(dashboard)/settings/_components/ai-settings.tsx`
- `src/app/(dashboard)/settings/_components/auth-settings.tsx`
- `src/app/(dashboard)/settings/service-accounts/page.tsx`
