---
estimated_steps: 4
estimated_files: 9
skills_used: []
---

# T03: Add error and empty states to library, alerts, and their sub-components

**Slice:** S03 — UI Consistency Sweep
**Milestone:** M001

## Description

Apply the same error/empty state treatment to library pages and alerts sub-components. Library pages need query error handling, environment guards updated to use `EmptyState`, and inline empty state divs replaced. Alerts sub-components need query error handling and inline empty state replacement. The alerts wrapper page just needs its environment guard replaced.

**Critical rule:** Preserve the exact text and CTAs for each page's empty states. Don't homogenize messages.

## Steps

1. **Alerts pages** — Apply to 5 files:
   - `alerts/page.tsx` (45 lines, no queries — just replace the inline "Select an environment to manage alerts" div with `<EmptyState title="Select an environment to manage alerts" />`)
   - `alerts/_components/alert-history-section.tsx` — Import `QueryError` and `EmptyState`. Add `if (eventsQuery.isError) return <QueryError message="Failed to load alert events" onRetry={() => eventsQuery.refetch()} />` before the loading check. Replace inline empty state with `<EmptyState title="No alert events yet" description="Alert events will appear here when rules are triggered." />`
   - `alerts/_components/alert-rules-section.tsx` — Import `QueryError` and `EmptyState`. Add error check on `rulesQuery`. Replace inline empty state with `<EmptyState title="No alert rules configured" description="Create an alert rule to monitor metrics and receive notifications." />`
   - `alerts/_components/notification-channels-section.tsx` — Import `QueryError` and `EmptyState`. Add error check on `channelsQuery`. Replace inline empty state with `<EmptyState title="No notification channels configured" description="Add a notification channel to receive alerts via Slack, Email, PagerDuty, or Webhook." />`
   - `alerts/_components/webhooks-section.tsx` — Import `QueryError`. Add error check on `webhooksQuery`. (No inline empty state to replace in this file.)

2. **Library pages** — Apply to 4 files:
   - `library/templates/page.tsx` — Import `QueryError` and `EmptyState`. Add error check on `templatesQuery`. Replace the compact `p-4` environment guard with `<EmptyState title="Select an environment from the header to use templates" className="p-4 text-sm" />`. Replace the `p-12` empty state with `<EmptyState icon={Terminal} title="No templates yet. Save a pipeline as a template to get started." />` (preserve the Terminal icon).
   - `library/shared-components/page.tsx` — Import `QueryError` and `EmptyState`. Add error check on `componentsQuery`. Replace compact environment guard with `<EmptyState title="Select an environment from the header to view shared components" className="p-4 text-sm" />`. Replace `p-12` empty state with `<EmptyState icon={Link2} title={components.length === 0 ? "No shared components yet. Create one to get started." : "No components match your search."} />` (preserve the Link2 icon and conditional text).
   - `library/shared-components/[id]/page.tsx` — Import `QueryError` and `EmptyState`. Add error check on `componentQuery`. Replace the compact environment guard with `<EmptyState title="Select an environment from the header to view this component" className="p-4 text-sm" />`. Replace the "not found" state with `<EmptyState title="Shared component not found" className="p-4 text-sm" />`.
   - `library/shared-components/new/page.tsx` — Import `EmptyState`. Replace compact environment guard with `<EmptyState title="Select an environment from the header to create a shared component" className="p-4 text-sm" />`. Replace "No components match your search" with `<EmptyState title="No components match your search." />`.

3. **Verify**: Run `pnpm exec tsc --noEmit` to confirm all changes compile cleanly.

4. **Check coverage**: Run `rg 'QueryError' src/app/\(dashboard\)/alerts/ src/app/\(dashboard\)/library/` to confirm imports are present in all data-fetching files.

## Must-Haves

- [ ] All 4 alerts sub-components have error handling via `QueryError`
- [ ] Alerts page inline environment guard replaced with `EmptyState`
- [ ] All 3 library data-fetching pages have error handling via `QueryError`
- [ ] All inline `border-dashed` divs in these 9 files replaced with `EmptyState` (preserving text/CTAs/icons)
- [ ] Compact `p-4` variants use `className="p-4 text-sm"` override
- [ ] `pnpm exec tsc --noEmit` exits 0

## Verification

- `pnpm exec tsc --noEmit` exits 0
- `rg 'border-dashed' src/app/\(dashboard\)/alerts/ src/app/\(dashboard\)/library/` returns 0 matches
- `rg 'QueryError' src/app/\(dashboard\)/alerts/_components/ src/app/\(dashboard\)/library/templates/page.tsx src/app/\(dashboard\)/library/shared-components/page.tsx src/app/\(dashboard\)/library/shared-components/\[id\]/page.tsx` — all data-fetching files contain QueryError

## Inputs

- `src/components/empty-state.tsx` — shared EmptyState component (created in T01)
- `src/components/query-error.tsx` — shared QueryError component (created in T01)
- `src/app/(dashboard)/alerts/page.tsx` — alerts wrapper page
- `src/app/(dashboard)/alerts/_components/alert-history-section.tsx` — alert events list
- `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx` — alert rules management
- `src/app/(dashboard)/alerts/_components/notification-channels-section.tsx` — notification channels
- `src/app/(dashboard)/alerts/_components/webhooks-section.tsx` — webhooks management
- `src/app/(dashboard)/library/templates/page.tsx` — templates page
- `src/app/(dashboard)/library/shared-components/page.tsx` — shared components list
- `src/app/(dashboard)/library/shared-components/[id]/page.tsx` — shared component detail
- `src/app/(dashboard)/library/shared-components/new/page.tsx` — create shared component

## Expected Output

- `src/app/(dashboard)/alerts/page.tsx` — environment guard replaced with EmptyState
- `src/app/(dashboard)/alerts/_components/alert-history-section.tsx` — error handling + empty state replaced
- `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx` — error handling + empty state replaced
- `src/app/(dashboard)/alerts/_components/notification-channels-section.tsx` — error handling + empty state replaced
- `src/app/(dashboard)/alerts/_components/webhooks-section.tsx` — error handling added
- `src/app/(dashboard)/library/templates/page.tsx` — error handling + environment guard + empty state replaced
- `src/app/(dashboard)/library/shared-components/page.tsx` — error handling + environment guard + empty state replaced
- `src/app/(dashboard)/library/shared-components/[id]/page.tsx` — error handling + guards replaced
- `src/app/(dashboard)/library/shared-components/new/page.tsx` — environment guard + empty state replaced
