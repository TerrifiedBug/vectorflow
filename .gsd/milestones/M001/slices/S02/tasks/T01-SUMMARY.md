---
id: T01
parent: S02
milestone: M001
provides:
  - alerts page split into 4 section components + constants module
  - thin page.tsx wrapper (45 lines)
key_files:
  - src/app/(dashboard)/alerts/page.tsx
  - src/app/(dashboard)/alerts/_components/alert-rules-section.tsx
  - src/app/(dashboard)/alerts/_components/notification-channels-section.tsx
  - src/app/(dashboard)/alerts/_components/webhooks-section.tsx
  - src/app/(dashboard)/alerts/_components/alert-history-section.tsx
  - src/app/(dashboard)/alerts/_components/constants.ts
key_decisions:
  - Form-state types (RuleFormState, ChannelFormState, WebhookFormState) kept co-located with their section components, not in shared constants
  - Helper functions (buildConfigFromForm, formFromConfig, parseHeaders) kept in the section that uses them exclusively
patterns_established:
  - Alert section components follow pattern: "use client" directive, own imports, own form-state types, exported named function
  - Shared constants (METRIC_LABELS, BINARY_METRICS, etc.) live in _components/constants.ts and are imported by sections that need them
observability_surfaces:
  - none
duration: 12m
verification_result: passed
completed_at: 2026-03-22T22:17:00Z
blocker_discovered: false
---

# T01: Split alerts page into section components

**Extracted 1910-line alerts page into 4 section components + constants module; page.tsx is now 45 lines**

## What Happened

Split `src/app/(dashboard)/alerts/page.tsx` (1910 lines) into 6 files:

1. **`_components/constants.ts`** (63 lines) — shared constants used across multiple sections: `METRIC_LABELS`, `CONDITION_LABELS`, `BINARY_METRICS`, `GLOBAL_METRICS`, `CHANNEL_TYPE_LABELS`, `CHANNEL_TYPE_ICONS`.

2. **`_components/alert-rules-section.tsx`** (569 lines) — `AlertRulesSection` with its `RuleFormState` type, `EMPTY_RULE_FORM`, and all rule CRUD/toggle mutations.

3. **`_components/notification-channels-section.tsx`** (750 lines) — `NotificationChannelsSection` with `ChannelFormState`, `buildConfigFromForm`, `formFromConfig` helpers, and all channel CRUD/test mutations.

4. **`_components/webhooks-section.tsx`** (439 lines) — `WebhooksSection` with `WebhookFormState`, `parseHeaders` helper, and legacy webhook CRUD/test mutations.

5. **`_components/alert-history-section.tsx`** (175 lines) — `AlertHistorySection` with cursor-based pagination and event display.

6. **`page.tsx`** (45 lines) — thin composition wrapper importing all 4 sections with `Separator` elements and environment gate.

Each section is self-contained with its own `"use client"` directive, imports, form-state types, and tRPC hooks. The initial tsc run revealed `AlertRulesSection` references `CHANNEL_TYPE_LABELS` in its channel badge display — fixed by adding that import from constants.

## Verification

All 8 task verification checks pass:
- `tsc --noEmit` exits 0
- `eslint src/` exits 0
- `page.tsx` is 45 lines (under 200)
- All 4 section component files and constants.ts exist
- `_components` directory exists

Slice-level checks relevant to T01 also pass:
- `wc -l src/app/(dashboard)/alerts/page.tsx` → 45 (under 200)
- `test -d src/app/(dashboard)/alerts/_components` → exists

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | 2.8s |
| 2 | `pnpm exec eslint src/` | 0 | ✅ pass | 11.7s |
| 3 | `wc -l src/app/(dashboard)/alerts/page.tsx` | 0 (45 lines) | ✅ pass | <1s |
| 4 | `test -f src/app/(dashboard)/alerts/_components/alert-rules-section.tsx` | 0 | ✅ pass | <1s |
| 5 | `test -f src/app/(dashboard)/alerts/_components/notification-channels-section.tsx` | 0 | ✅ pass | <1s |
| 6 | `test -f src/app/(dashboard)/alerts/_components/webhooks-section.tsx` | 0 | ✅ pass | <1s |
| 7 | `test -f src/app/(dashboard)/alerts/_components/alert-history-section.tsx` | 0 | ✅ pass | <1s |
| 8 | `test -f src/app/(dashboard)/alerts/_components/constants.ts` | 0 | ✅ pass | <1s |

## Diagnostics

No runtime observability changes — this is a pure structural refactor. The same tRPC queries, mutations, and toast notifications exist in the extracted components. To verify correct rendering, load the alerts page in a browser and confirm all 4 sections display.

## Deviations

- `CHANNEL_TYPE_LABELS` import was missing from `alert-rules-section.tsx` — the channel badge in the rule dialog's channel selector uses this constant. Added the import after the first tsc check caught it.

## Known Issues

None.

## Files Created/Modified

- `src/app/(dashboard)/alerts/page.tsx` — rewritten as 45-line thin composition wrapper
- `src/app/(dashboard)/alerts/_components/constants.ts` — shared constants (METRIC_LABELS, BINARY_METRICS, etc.)
- `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx` — AlertRulesSection component (569 lines)
- `src/app/(dashboard)/alerts/_components/notification-channels-section.tsx` — NotificationChannelsSection component (750 lines)
- `src/app/(dashboard)/alerts/_components/webhooks-section.tsx` — WebhooksSection component (439 lines)
- `src/app/(dashboard)/alerts/_components/alert-history-section.tsx` — AlertHistorySection component (175 lines)
