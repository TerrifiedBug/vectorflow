# S03: UI Consistency Sweep — UAT Script

**Purpose:** Verify that all dashboard pages show consistent loading, empty, and error states after the UI consistency sweep.

## Preconditions

- Application running locally (`pnpm dev`)
- Logged in as an admin user with access to all dashboard sections
- At least one environment exists (for pages that require environment selection)
- Database is accessible

---

## Test Case 1: EmptyState component renders on pages with no data

**Precondition:** User has an environment selected, but no pipelines exist in that environment.

| Step | Action | Expected Outcome |
|------|--------|-----------------|
| 1 | Navigate to `/pipelines` | EmptyState shows with "No pipelines" message and a CTA to create one |
| 2 | Navigate to `/fleet` | EmptyState shows with "No nodes" message |
| 3 | Navigate to `/audit` | EmptyState shows with audit-specific messaging |
| 4 | Navigate to `/library/templates` | EmptyState shows with template-specific messaging and Terminal icon |
| 5 | Navigate to `/library/shared-components` | EmptyState shows with shared-component messaging and Link2 icon |
| 6 | Navigate to `/alerts` → Alert Rules tab | EmptyState shows "No alert rules configured" with descriptive text |
| 7 | Navigate to `/alerts` → Notification Channels tab | EmptyState shows "No notification channels configured" |
| 8 | Navigate to `/alerts` → Alert History tab | EmptyState shows "No alert events yet" |
| 9 | Navigate to `/settings/service-accounts` | EmptyState shows with service accounts messaging |

**Pass criteria:** All 9 pages show a centered, bordered-dashed EmptyState with an icon, title, and description — no blank white screens.

---

## Test Case 2: Environment guard on environment-dependent pages

**Precondition:** No environment is selected (clear selection if needed).

| Step | Action | Expected Outcome |
|------|--------|-----------------|
| 1 | Navigate to `/` (dashboard main page) | EmptyState shows "Select an environment to view dashboard" |
| 2 | Navigate to `/pipelines` | EmptyState shows environment selection prompt |
| 3 | Navigate to `/library/templates` | Compact EmptyState (p-4 text-sm) shows environment selection prompt |
| 4 | Navigate to `/library/shared-components` | Compact EmptyState shows environment selection prompt |
| 5 | Navigate to `/alerts` | EmptyState shows environment selection prompt |
| 6 | Select an environment from the sidebar | Page content loads normally |

**Pass criteria:** All environment-dependent pages show an EmptyState guard when no environment is selected — never a blank page or JavaScript error.

---

## Test Case 3: QueryError renders on query failure

**Precondition:** Simulate a backend error. Easiest method: stop the database temporarily, or use browser DevTools to block tRPC requests (`**/trpc/**`).

| Step | Action | Expected Outcome |
|------|--------|-----------------|
| 1 | Block API requests, navigate to `/analytics` | QueryError shows with AlertTriangle icon, "Failed to load data" message, and a "Retry" button |
| 2 | Click "Retry" button | The page attempts to refetch data (network request visible in DevTools) |
| 3 | Navigate to `/pipelines` | QueryError shows with retry button |
| 4 | Navigate to `/environments` | QueryError shows with retry button |
| 5 | Navigate to `/settings` → Fleet Settings tab | QueryError shows with retry button |
| 6 | Navigate to `/settings` → Teams tab | QueryError shows with retry button |
| 7 | Navigate to `/settings` → Auth tab | QueryError shows with retry button |
| 8 | Unblock API requests, click "Retry" on any error page | Page loads normally with real data |

**Pass criteria:** Every data-fetching page shows a styled error with retry — never a blank screen or unhandled error. Retry button triggers refetch.

---

## Test Case 4: Analytics loading skeleton

**Precondition:** Network throttled to Slow 3G in DevTools (to make loading visible).

| Step | Action | Expected Outcome |
|------|--------|-----------------|
| 1 | Navigate to `/analytics` | Skeleton placeholders appear: 4 stat cards + chart area + table area |
| 2 | Wait for data to load | Skeletons transition to real data smoothly |

**Pass criteria:** Loading state shows structured skeletons (not a blank page or a single spinner).

---

## Test Case 5: Settings sub-components error handling

**Precondition:** Block API requests.

| Step | Action | Expected Outcome |
|------|--------|-----------------|
| 1 | Navigate to `/settings` → Version Check section | QueryError renders inline inside the Card (not full-page) |
| 2 | Navigate to `/settings` → AI Settings tab | QueryError shows with retry |
| 3 | Navigate to `/settings` → SCIM tab | QueryError shows with retry |
| 4 | Navigate to `/settings` → Audit Shipping tab | QueryError shows with retry |
| 5 | Navigate to `/settings` → Backup tab | QueryError shows with retry |

**Pass criteria:** All settings sub-components show inline QueryError — the settings page layout remains intact with individual sections showing errors.

---

## Test Case 6: Webhooks error visibility

**Precondition:** Block API requests, navigate to alerts page.

| Step | Action | Expected Outcome |
|------|--------|-----------------|
| 1 | Navigate to `/alerts` → Webhooks section | QueryError is visible even though the section normally hides when empty |

**Pass criteria:** Error state overrides the hide-when-empty behavior — errors are always surfaced to the user.

---

## Test Case 7: No inline border-dashed patterns remain

**Precondition:** Access to project codebase.

| Step | Action | Expected Outcome |
|------|--------|-----------------|
| 1 | Run `rg 'border border-dashed' src/app/\(dashboard\)/` | Zero matches — all inline empty states replaced with shared EmptyState component |

**Pass criteria:** Command returns no output (exit code 1).

---

## Edge Cases

| Case | Verification |
|------|-------------|
| Fleet node detail page with missing node | Navigate to `/fleet/nonexistent-id` — should show EmptyState "Node not found" (not a crash) |
| Fleet node with no pipeline metrics | View a node that has connected but run no pipelines — should show EmptyState "No pipeline metrics yet" |
| Library shared component detail for deleted component | Navigate to `/library/shared-components/nonexistent-id` — should show EmptyState, not crash |
| Rapid environment switching | Switch environments quickly while pages are loading — should not leave error states stuck |
