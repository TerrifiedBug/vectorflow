---
estimated_steps: 4
estimated_files: 10
skills_used: []
---

# T02: Replace inline duplicate definitions with imports from shared modules

**Slice:** S01 — TypeScript Fixes & Shared Utilities
**Milestone:** M001

## Description

Remove all inline duplicate utility functions from consumer files and replace them with imports from the shared modules created in T01. This completes R004 (duplicated utilities extracted to `src/lib/`) and ensures no inline copies remain.

## Steps

1. Update pipeline status consumers (4 files):
   - `src/app/(dashboard)/pipelines/page.tsx` — add `import { aggregateProcessStatus } from "@/lib/pipeline-status"`, delete the inline `function aggregateProcessStatus(...)` definition (approximately lines near the top of the file, before the component).
   - `src/app/(dashboard)/pipelines/[id]/page.tsx` — same: add import, delete inline definition.
   - `src/app/(dashboard)/page.tsx` — add `import { derivePipelineStatus } from "@/lib/pipeline-status"`, delete the inline `function derivePipelineStatus(...)` definition.
   - `src/components/dashboard/custom-view.tsx` — same: add import, delete inline definition.

2. Update formatTime consumers (5 files):
   - `src/components/fleet/event-log.tsx` — add `import { formatTime } from "@/lib/format"` and `import { STATUS_COLORS, statusColor } from "@/lib/status"`. Delete the inline `function formatTime(...)`, `const STATUS_COLORS = ...`, and `function statusColor(...)` definitions.
   - `src/components/fleet/status-timeline.tsx` — add `import { formatTime } from "@/lib/format"` and `import { STATUS_COLORS, statusColor } from "@/lib/status"`. Delete the inline `function formatTime(...)`, `const STATUS_COLORS = ...`, and `function statusColor(...)` definitions.
   - `src/components/fleet/node-metrics-charts.tsx` — add `import { formatTime } from "@/lib/format"`. Delete the inline `function formatTime(...)` definition.
   - `src/components/fleet/node-logs.tsx` — add `import { formatTimeWithSeconds } from "@/lib/format"`. Delete the inline `function formatTime(...)` definition. Rename all call sites from `formatTime(...)` to `formatTimeWithSeconds(...)`.
   - `src/components/pipeline/pipeline-logs.tsx` — add `import { formatTimeWithSeconds } from "@/lib/format"`. Delete the inline `function formatTime(...)` definition. Rename all call sites from `formatTime(...)` to `formatTimeWithSeconds(...)`.

3. Update audit page formatTimestamp:
   - `src/app/(dashboard)/audit/page.tsx` — add `import { formatTimestamp } from "@/lib/format"`. Delete the inline `function formatTimestamp(...)` definition.

4. Run full verification:
   - `pnpm exec tsc --noEmit` — must exit 0
   - `pnpm exec eslint src/` — must exit 0
   - Grep checks to confirm no inline duplicates remain

## Must-Haves

- [ ] No inline `aggregateProcessStatus` definitions in `src/app/` or `src/components/`
- [ ] No inline `derivePipelineStatus` definitions in `src/app/` or `src/components/`
- [ ] No inline `formatTime` definitions in `src/app/` or `src/components/`
- [ ] No inline `STATUS_COLORS` / `statusColor` definitions in `src/components/fleet/`
- [ ] `tsc --noEmit` exits 0
- [ ] `eslint src/` exits 0

## Verification

- `pnpm exec tsc --noEmit` exits 0
- `pnpm exec eslint src/` exits 0
- `rg 'function aggregateProcessStatus' src/app src/components` returns no matches (exit code 1)
- `rg 'function derivePipelineStatus' src/app src/components` returns no matches (exit code 1)
- `rg '^function formatTime' src/app src/components` returns no matches (exit code 1)
- `rg '^const STATUS_COLORS' src/components/fleet` returns no matches (exit code 1)
- `rg '^function formatTimestamp' src/app` returns no matches (exit code 1)

## Inputs

- `src/lib/pipeline-status.ts` — shared module created in T01 (exports `aggregateProcessStatus`, `derivePipelineStatus`)
- `src/lib/format.ts` — shared format module extended in T01 (exports `formatTime`, `formatTimeWithSeconds`, `formatTimestamp`)
- `src/lib/status.ts` — shared status module extended in T01 (exports `STATUS_COLORS`, `statusColor`)
- `src/app/(dashboard)/pipelines/page.tsx` — consumer to update
- `src/app/(dashboard)/pipelines/[id]/page.tsx` — consumer to update
- `src/app/(dashboard)/page.tsx` — consumer to update
- `src/components/dashboard/custom-view.tsx` — consumer to update
- `src/components/fleet/event-log.tsx` — consumer to update
- `src/components/fleet/status-timeline.tsx` — consumer to update
- `src/components/fleet/node-metrics-charts.tsx` — consumer to update
- `src/components/fleet/node-logs.tsx` — consumer to update
- `src/components/pipeline/pipeline-logs.tsx` — consumer to update
- `src/app/(dashboard)/audit/page.tsx` — consumer to update

## Expected Output

- `src/app/(dashboard)/pipelines/page.tsx` — imports `aggregateProcessStatus` from shared module, inline definition removed
- `src/app/(dashboard)/pipelines/[id]/page.tsx` — imports `aggregateProcessStatus` from shared module, inline definition removed
- `src/app/(dashboard)/page.tsx` — imports `derivePipelineStatus` from shared module, inline definition removed
- `src/components/dashboard/custom-view.tsx` — imports `derivePipelineStatus` from shared module, inline definition removed
- `src/components/fleet/event-log.tsx` — imports `formatTime`, `STATUS_COLORS`, `statusColor` from shared modules, inline definitions removed
- `src/components/fleet/status-timeline.tsx` — imports `formatTime`, `STATUS_COLORS`, `statusColor` from shared modules, inline definitions removed
- `src/components/fleet/node-metrics-charts.tsx` — imports `formatTime` from shared module, inline definition removed
- `src/components/fleet/node-logs.tsx` — imports `formatTimeWithSeconds` from shared module, inline definition removed, call sites renamed
- `src/components/pipeline/pipeline-logs.tsx` — imports `formatTimeWithSeconds` from shared module, inline definition removed, call sites renamed
- `src/app/(dashboard)/audit/page.tsx` — imports `formatTimestamp` from shared module, inline definition removed
