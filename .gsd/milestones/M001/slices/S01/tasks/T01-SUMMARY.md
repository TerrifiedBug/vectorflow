---
id: T01
parent: S01
milestone: M001
provides:
  - shared pipeline-status module (aggregateProcessStatus, derivePipelineStatus)
  - shared formatTime and formatTimeWithSeconds in format.ts
  - shared STATUS_COLORS and statusColor in status.ts
  - updated formatTimestamp with explicit locale options
key_files:
  - src/lib/pipeline-status.ts
  - src/lib/format.ts
  - src/lib/status.ts
key_decisions:
  - Matched reference implementations exactly (no logic changes) to ensure zero-risk extraction
patterns_established:
  - Pipeline status derivation lives in src/lib/pipeline-status.ts — all consumers must import from there
  - Node health color mapping lives in src/lib/status.ts alongside status variant helpers
observability_surfaces:
  - tsc --noEmit validates exported type signatures; rg can verify no inline duplicates remain after T02
duration: 5m
verification_result: passed
completed_at: 2026-03-22
blocker_discovered: false
---

# T01: Create shared utility modules for pipeline status, time formatting, and status colors

**Created src/lib/pipeline-status.ts and extended format.ts and status.ts with extracted shared utilities for T02 consumer wiring**

## What Happened

Created `src/lib/pipeline-status.ts` as a new shared module with `aggregateProcessStatus` and `derivePipelineStatus`, copied verbatim from their reference implementations in `pipelines/page.tsx` and `page.tsx`. Extended `src/lib/format.ts` with `formatTime` (HH:MM) and `formatTimeWithSeconds` (HH:MM:SS), and updated the existing `formatTimestamp` to use explicit locale options matching the audit page's version. Extended `src/lib/status.ts` with `STATUS_COLORS` constant and `statusColor` function from `event-log.tsx`.

All implementations were verified against their reference sources to ensure behavioral equivalence.

## Verification

- `tsc --noEmit` exits 0 — all new exports compile cleanly
- `test -f src/lib/pipeline-status.ts` exits 0 — file exists
- All 8 rg checks for exported symbols match in the correct files

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | 1.8s |
| 2 | `test -f src/lib/pipeline-status.ts` | 0 | ✅ pass | 0s |
| 3 | `rg 'export function aggregateProcessStatus' src/lib/pipeline-status.ts` | 0 | ✅ pass | 0s |
| 4 | `rg 'export function derivePipelineStatus' src/lib/pipeline-status.ts` | 0 | ✅ pass | 0s |
| 5 | `rg 'export function formatTime' src/lib/format.ts` | 0 | ✅ pass | 0s |
| 6 | `rg 'export function formatTimeWithSeconds' src/lib/format.ts` | 0 | ✅ pass | 0s |
| 7 | `rg 'export const STATUS_COLORS' src/lib/status.ts` | 0 | ✅ pass | 0s |
| 8 | `rg 'export function statusColor' src/lib/status.ts` | 0 | ✅ pass | 0s |

### Slice-level checks (partial — T02 will complete these)

| # | Command | Exit Code | Verdict | Notes |
|---|---------|-----------|---------|-------|
| 1 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | |
| 2 | `rg 'function aggregateProcessStatus' src/app src/components` | 0 (matches) | ⏳ expected | Inline copies remain until T02 |
| 3 | `rg 'function derivePipelineStatus' src/app src/components` | 0 (matches) | ⏳ expected | Inline copies remain until T02 |
| 4 | `rg '^function formatTime' src/app src/components` | 0 (matches) | ⏳ expected | Inline copies remain until T02 |
| 5 | `rg '^const STATUS_COLORS' src/components/fleet` | 0 (matches) | ⏳ expected | Inline copies remain until T02 |
| 6 | `test -f src/lib/pipeline-status.ts` | 0 | ✅ pass | |

## Diagnostics

- Verify shared API surface: `rg 'export function|export const' src/lib/pipeline-status.ts src/lib/format.ts src/lib/status.ts`
- Compilation check: `pnpm exec tsc --noEmit` — any export signature mismatch will surface here once T02 wires consumers
- No runtime signals — these are pure utility functions with no side effects

## Deviations

None — all implementations matched the plan exactly.

## Known Issues

None.

## Files Created/Modified

- `src/lib/pipeline-status.ts` — new shared module with `aggregateProcessStatus` and `derivePipelineStatus`
- `src/lib/format.ts` — added `formatTime`, `formatTimeWithSeconds`; updated `formatTimestamp` with explicit locale options
- `src/lib/status.ts` — added `STATUS_COLORS` constant and `statusColor` function
- `.gsd/milestones/M001/slices/S01/S01-PLAN.md` — added Observability / Diagnostics section (pre-flight fix)
- `.gsd/milestones/M001/slices/S01/tasks/T01-PLAN.md` — added Observability Impact section (pre-flight fix)
