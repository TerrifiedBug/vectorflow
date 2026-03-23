---
estimated_steps: 5
estimated_files: 9
skills_used: []
---

# T02: Add error, loading, and empty states to core dashboard pages

**Slice:** S03 — UI Consistency Sweep
**Milestone:** M001

## Description

Add query error handling, replace inline empty states with the shared `EmptyState` component, add a loading skeleton to the analytics page, and add a "select an environment" guard to the dashboard main page. These are the highest-traffic pages and represent the most visible R005 improvements.

**Critical rule:** When replacing inline empty state divs with `<EmptyState>`, preserve the exact text and CTAs for each page. Don't homogenize messages.

## Steps

1. **`src/app/(dashboard)/page.tsx` (dashboard main)** — This page has multiple queries (`viewsQuery`, `stats`, `pipelineCards`, `chartData`) all gated by `enabled: !!selectedEnvironmentId`. Add:
   - Import `EmptyState` from `@/components/empty-state` and `QueryError` from `@/components/query-error`
   - A "select environment" guard: after the hooks, before the return, add `if (!selectedEnvironmentId) return <EmptyState title="Select an environment to view the dashboard" />` (match the pattern used in analytics page)
   - An error check on `stats` query (the primary data query): `if (stats.isError) return <QueryError message="Failed to load dashboard data" onRetry={() => stats.refetch()} />`
   - Place these guards early in the render, after all hooks but before the main JSX.

2. **`src/app/(dashboard)/analytics/page.tsx`** — Currently has NO loading skeleton (the only data page without one) and the "no environment" guard uses an inline div. Add:
   - Import `EmptyState` from `@/components/empty-state`, `QueryError` from `@/components/query-error`, `Skeleton` from `@/components/ui/skeleton`
   - Replace the inline "Select an environment" div (around line 152) with `<EmptyState title="Select an environment to view analytics" />`
   - Add error check: after the environment guard, add `if (analytics.isError) return <div className="space-y-6"><QueryError message="Failed to load analytics data" onRetry={() => analytics.refetch()} /></div>`
   - Add loading skeleton: after the error check, add `if (analytics.isLoading) return <div className="space-y-6"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}</div><Skeleton className="h-64 w-full" /><Skeleton className="h-48 w-full" /></div>` (4 KPI card skeletons + chart + table)

3. **`src/app/(dashboard)/audit/page.tsx`** — Has a primary `auditQuery` and several filter queries. Add:
   - Import `EmptyState` and `QueryError`
   - Replace the inline empty state div (~line 328) with `<EmptyState title="No audit log entries found" description="Actions will appear here as they are performed" />`
   - Add error check on the main audit query (find the primary data-fetching query): `if (query.isError) return <QueryError message="Failed to load audit log" onRetry={() => query.refetch()} />`

4. **Environments, Fleet, Pipelines pages** — For each of these 6 files, apply the same pattern:
   - Import `EmptyState` and `QueryError`
   - Add `isError` check on the primary query, rendering `QueryError` with appropriate message and `onRetry`
   - Replace inline `border-dashed` empty state divs with `<EmptyState>`, preserving exact text and CTAs:
     - `environments/page.tsx`: title="No environments yet", action={label: "Create your first environment", href: "/environments/new"}
     - `environments/[id]/page.tsx`: title="No nodes in this environment yet", action={label: "Go to Fleet", href: "/fleet"}, className="p-8" (this page uses p-8 not p-12)
     - `fleet/page.tsx`: title="No agents enrolled yet", description="Generate an enrollment token in the environment settings to connect agents."
     - `pipelines/page.tsx`: title="No pipelines yet", action={label: "Create your first pipeline", href: "/pipelines/new"}
     - `pipelines/[id]/page.tsx`: Add error check only (no inline empty state exists)
     - `pipelines/[id]/metrics/page.tsx`: title="No metrics data available yet", description="Metrics appear after the pipeline is deployed and agents begin reporting heartbeats."

5. **Verify**: Run `pnpm exec tsc --noEmit` to confirm all changes compile cleanly.

## Must-Haves

- [ ] Dashboard page has "select environment" guard using `EmptyState`
- [ ] Dashboard page has error check on `stats` query using `QueryError`
- [ ] Analytics page has loading skeleton (4 KPI cards + chart + table)
- [ ] Analytics page inline "select environment" div replaced with `EmptyState`
- [ ] Analytics page has error check on `analytics` query
- [ ] All 9 pages import and use `QueryError` for error handling
- [ ] All inline `border-dashed` divs in these 9 files replaced with `EmptyState` (preserving exact text/CTAs)
- [ ] `pnpm exec tsc --noEmit` exits 0

## Verification

- `pnpm exec tsc --noEmit` exits 0
- `rg 'QueryError' src/app/\(dashboard\)/page.tsx src/app/\(dashboard\)/analytics/page.tsx src/app/\(dashboard\)/fleet/page.tsx src/app/\(dashboard\)/pipelines/page.tsx` — all 4 files contain QueryError imports
- `rg 'border-dashed' src/app/\(dashboard\)/page.tsx src/app/\(dashboard\)/analytics/page.tsx src/app/\(dashboard\)/audit/page.tsx src/app/\(dashboard\)/environments/page.tsx src/app/\(dashboard\)/fleet/page.tsx src/app/\(dashboard\)/pipelines/page.tsx` — returns 0 matches (all inline empty states replaced)
- `rg 'Skeleton' src/app/\(dashboard\)/analytics/page.tsx` — confirms Skeleton is now imported/used

## Observability Impact

- **Signals changed**: No runtime telemetry is added. `QueryError` renders an inline "Failed to load data" message with a retry button when a tRPC query errors — this replaces blank screens with visible feedback, making failures user-observable without server-side logging.
- **Inspection surfaces**: `rg -l 'QueryError' src/app/\(dashboard\)/` shows which pages have error handling wired in (9 after this task). `rg -l 'EmptyState' src/app/\(dashboard\)/` shows which pages use the shared empty state (8 after this task — `pipelines/[id]/page.tsx` uses QueryError only). `rg 'border-dashed' <file>` returning 0 confirms no inline patterns remain in the given file.
- **Failure visibility**: Each query error now renders a visible `QueryError` component with a retry button instead of a blank screen. The user sees the error and can retry without refreshing.
- **Redaction constraints**: None — components render only UI labels and icons.

## Inputs

- `src/components/empty-state.tsx` — shared EmptyState component (created in T01)
- `src/components/query-error.tsx` — shared QueryError component (created in T01)
- `src/app/(dashboard)/page.tsx` — dashboard main page
- `src/app/(dashboard)/analytics/page.tsx` — analytics page (needs loading skeleton + error + empty state)
- `src/app/(dashboard)/audit/page.tsx` — audit page
- `src/app/(dashboard)/environments/page.tsx` — environments list page
- `src/app/(dashboard)/environments/[id]/page.tsx` — environment detail page
- `src/app/(dashboard)/fleet/page.tsx` — fleet page
- `src/app/(dashboard)/pipelines/page.tsx` — pipelines list page
- `src/app/(dashboard)/pipelines/[id]/page.tsx` — pipeline detail page
- `src/app/(dashboard)/pipelines/[id]/metrics/page.tsx` — pipeline metrics page

## Expected Output

- `src/app/(dashboard)/page.tsx` — environment guard + error handling added
- `src/app/(dashboard)/analytics/page.tsx` — loading skeleton + error handling + empty state replaced
- `src/app/(dashboard)/audit/page.tsx` — error handling + empty state replaced
- `src/app/(dashboard)/environments/page.tsx` — error handling + empty state replaced
- `src/app/(dashboard)/environments/[id]/page.tsx` — error handling + empty state replaced (p-8 variant)
- `src/app/(dashboard)/fleet/page.tsx` — error handling + empty state replaced
- `src/app/(dashboard)/pipelines/page.tsx` — error handling + empty state replaced
- `src/app/(dashboard)/pipelines/[id]/page.tsx` — error handling added
- `src/app/(dashboard)/pipelines/[id]/metrics/page.tsx` — error handling + empty state replaced
