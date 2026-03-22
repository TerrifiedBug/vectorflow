---
estimated_steps: 5
estimated_files: 7
skills_used:
  - lint
  - review
---

# T01: Split alerts page into section components

**Slice:** S02 — Router & Component Refactoring
**Milestone:** M001

## Description

The alerts page (`src/app/(dashboard)/alerts/page.tsx`) is 1910 lines — the single largest non-exempt file in the codebase. It contains 4 clearly separated sections (`AlertRulesSection` at L144-630, `NotificationChannelsSection` at L742-1324, `WebhooksSection` at L1339-1721, `AlertHistorySection` at L1724-1875) that are already self-contained with their own tRPC queries, mutations, and local state. The main export (L1878-1910) is a thin wrapper composing them with `<Separator>`.

This task extracts each section into its own file under `src/app/(dashboard)/alerts/_components/`, with shared constants in a `constants.ts` file. The main `page.tsx` becomes a ~50-100 line composition wrapper.

## Steps

1. **Read the full alerts page** to identify all shared constants, types, and imports at the top of the file (L1-142). Identify which types/constants are truly shared across sections vs. section-specific.

2. **Create `_components/constants.ts`** with shared constants and types that are used by multiple sections (e.g., environment-related constants, shared enums). Do NOT put form-state types (`RuleFormState`, `ChannelFormState`, etc.) here — keep them co-located with their section to avoid pulling in section-specific deps.

3. **Extract each section into its own file:**
   - `_components/alert-rules-section.tsx` — `AlertRulesSection` function (L144-630) plus any helpers used exclusively by it (check L65-142 for section-specific helpers/types). Include all necessary imports (React, tRPC hooks, UI components, types).
   - `_components/notification-channels-section.tsx` — `NotificationChannelsSection` function (L742-1324) plus helper functions at L671-741 that are exclusive to this section.
   - `_components/webhooks-section.tsx` — `WebhooksSection` function (L1339-1721) with its local helpers.
   - `_components/alert-history-section.tsx` — `AlertHistorySection` function (L1724-1875) with its local helpers.

4. **Rewrite `page.tsx`** as a thin composition wrapper: imports from `_components/`, renders `AlertsPage` component that composes the 4 sections with environment selector and `<Separator>` elements. Should be ~50-100 lines.

5. **Verify** `tsc --noEmit` and `eslint src/` both pass clean. Check `wc -l` on `page.tsx` to confirm under 200 lines.

## Must-Haves

- [ ] `page.tsx` under 200 lines after extraction
- [ ] All 4 section component files exist and are importable
- [ ] Shared constants in `_components/constants.ts` — form-state types stay co-located with their section
- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm exec eslint src/` exits 0
- [ ] No changes to the alert page's runtime behavior — same components, same props, same rendering

## Verification

- `pnpm exec tsc --noEmit` exits 0
- `pnpm exec eslint src/` exits 0
- `wc -l src/app/(dashboard)/alerts/page.tsx` — under 200 lines
- `test -f src/app/(dashboard)/alerts/_components/alert-rules-section.tsx`
- `test -f src/app/(dashboard)/alerts/_components/notification-channels-section.tsx`
- `test -f src/app/(dashboard)/alerts/_components/webhooks-section.tsx`
- `test -f src/app/(dashboard)/alerts/_components/alert-history-section.tsx`
- `test -f src/app/(dashboard)/alerts/_components/constants.ts`

## Inputs

- `src/app/(dashboard)/alerts/page.tsx` — the 1910-line source file to split

## Expected Output

- `src/app/(dashboard)/alerts/page.tsx` — rewritten as thin composition wrapper (~50-100 lines)
- `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx` — AlertRulesSection component (~500 lines)
- `src/app/(dashboard)/alerts/_components/notification-channels-section.tsx` — NotificationChannelsSection component (~600 lines)
- `src/app/(dashboard)/alerts/_components/webhooks-section.tsx` — WebhooksSection component (~400 lines)
- `src/app/(dashboard)/alerts/_components/alert-history-section.tsx` — AlertHistorySection component (~160 lines)
- `src/app/(dashboard)/alerts/_components/constants.ts` — shared constants and types
