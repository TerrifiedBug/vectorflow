# S01 — Research: TypeScript Fixes & Shared Utilities

**Date:** 2026-03-22
**Depth:** Light — straightforward utility extraction following established codebase patterns

## Summary

R001 (`tsc --noEmit` zero errors) and R008 (clean `eslint`) are **already satisfied** — both commands exit 0 on the current codebase. The only remaining work for S01 is R004: extracting duplicated utility functions into shared modules in `src/lib/`.

There are two clear duplication clusters: (1) **pipeline status derivation** — `aggregateProcessStatus` is copy-pasted identically in 2 files, and `derivePipelineStatus` is copy-pasted identically in 2 files; (2) **time/status formatting** — `formatTime` appears in 5 files (two variants: with-seconds and without-seconds), `STATUS_COLORS` + `statusColor` are duplicated identically in 2 files, and `formatTimestamp` in the audit page shadows the shared version in `src/lib/format.ts`.

The codebase already has well-established shared modules (`src/lib/format.ts`, `src/lib/status.ts`, `src/lib/badge-variants.ts`) that are imported across 12+ consumers. The work is mechanical: add new exports to existing modules (or create one new module), update imports in consuming files, delete inline definitions, and verify `tsc --noEmit` still passes.

## Recommendation

Extract all duplicated utilities into two files:
1. **`src/lib/pipeline-status.ts`** (new) — `aggregateProcessStatus()` and `derivePipelineStatus()` since these are pipeline-specific logic that doesn't belong in the general `status.ts`
2. **`src/lib/format.ts`** (extend) — add `formatTime()` (HH:MM variant) and `formatTimeWithSeconds()` (HH:MM:SS variant) alongside existing formatting helpers
3. **`src/lib/status.ts`** (extend) — add `STATUS_COLORS` map and `statusColor()` function alongside existing status variant helpers

This follows the existing codebase pattern exactly and keeps related concerns grouped.

## Implementation Landscape

### Key Files

**New file to create:**
- `src/lib/pipeline-status.ts` — will export `aggregateProcessStatus()` and `derivePipelineStatus()`

**Existing shared modules to extend:**
- `src/lib/format.ts` (83 lines) — add `formatTime()` and `formatTimeWithSeconds()` exports
- `src/lib/status.ts` (55 lines) — add `STATUS_COLORS` constant and `statusColor()` function

**Consumer files to update (remove inline definitions, add imports):**

| File | Functions to remove | Import from |
|------|-------------------|-------------|
| `src/app/(dashboard)/pipelines/page.tsx` | `aggregateProcessStatus` | `@/lib/pipeline-status` |
| `src/app/(dashboard)/pipelines/[id]/page.tsx` | `aggregateProcessStatus` | `@/lib/pipeline-status` |
| `src/app/(dashboard)/page.tsx` | `derivePipelineStatus` | `@/lib/pipeline-status` |
| `src/components/dashboard/custom-view.tsx` | `derivePipelineStatus` | `@/lib/pipeline-status` |
| `src/components/fleet/event-log.tsx` | `STATUS_COLORS`, `statusColor`, `formatTime` | `@/lib/status`, `@/lib/format` |
| `src/components/fleet/status-timeline.tsx` | `STATUS_COLORS`, `statusColor`, `formatTime` | `@/lib/status`, `@/lib/format` |
| `src/components/fleet/node-metrics-charts.tsx` | `formatTime` | `@/lib/format` |
| `src/components/fleet/node-logs.tsx` | `formatTime` (with-seconds variant) | `@/lib/format` |
| `src/components/pipeline/pipeline-logs.tsx` | `formatTime` (with-seconds variant) | `@/lib/format` |

### Build Order

1. **Create `src/lib/pipeline-status.ts`** — new shared module with `aggregateProcessStatus` and `derivePipelineStatus`
2. **Extend `src/lib/format.ts`** — add `formatTime` and `formatTimeWithSeconds`
3. **Extend `src/lib/status.ts`** — add `STATUS_COLORS` and `statusColor`
4. **Update all 9 consumer files** — replace inline definitions with imports
5. **Verify** — run `tsc --noEmit` and `eslint` to confirm zero regressions

### Verification Approach

```bash
pnpm exec tsc --noEmit       # must exit 0
pnpm exec eslint src/         # must exit 0
# Verify no inline duplicates remain:
rg 'function aggregateProcessStatus' src/app src/components  # should return nothing
rg 'function derivePipelineStatus' src/app src/components    # should return nothing
rg '^function formatTime' src/app src/components             # should return nothing
rg '^const STATUS_COLORS' src/components/fleet               # should return nothing
```

## Constraints

- `src/lib/pipeline-status.ts` is specified in the M001 Boundary Map as a deliverable of S01 — downstream slices S02-S05 depend on it existing with `aggregateProcessStatus()` and `derivePipelineStatus()` exports
- The `formatTime` name is used locally in 5 files — the shared version needs distinct names for the two variants (`formatTime` for HH:MM, `formatTimeWithSeconds` for HH:MM:SS) to avoid ambiguity
- All consumer files are `"use client"` components — the shared modules must not use server-only imports (they don't — they're pure functions)