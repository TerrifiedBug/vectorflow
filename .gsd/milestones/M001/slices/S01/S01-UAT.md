# S01: TypeScript Fixes & Shared Utilities — UAT

**Milestone:** M001
**Written:** 2026-03-22

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: This slice is a pure refactoring — no runtime behavior changes, no new UI, no API changes. All verification is through static analysis (tsc, eslint) and code structure checks (grep). The shared modules export pure functions with no side effects.

## Preconditions

- Working directory is the project root with `node_modules` installed (`pnpm install` has been run)
- `pnpm exec tsc --noEmit` must be functional (TypeScript configured)
- `pnpm exec eslint` must be functional (ESLint configured)

## Smoke Test

Run `pnpm exec tsc --noEmit && pnpm exec eslint src/` — both must exit 0. This confirms the refactoring didn't break anything.

## Test Cases

### 1. Shared modules exist with correct exports

1. Run `test -f src/lib/pipeline-status.ts && echo OK`
2. Run `rg 'export function aggregateProcessStatus' src/lib/pipeline-status.ts`
3. Run `rg 'export function derivePipelineStatus' src/lib/pipeline-status.ts`
4. Run `rg 'export function formatTime\b' src/lib/format.ts`
5. Run `rg 'export function formatTimeWithSeconds' src/lib/format.ts`
6. Run `rg 'export const STATUS_COLORS' src/lib/status.ts`
7. Run `rg 'export function statusColor' src/lib/status.ts`
8. **Expected:** All commands return matches. The shared modules exist and export the correct functions.

### 2. No inline duplicates remain in consumer files

1. Run `rg 'function aggregateProcessStatus' src/app src/components`
2. Run `rg 'function derivePipelineStatus' src/app src/components`
3. Run `rg '^function formatTime' src/app src/components`
4. Run `rg '^const STATUS_COLORS' src/components/fleet`
5. Run `rg '^function formatTimestamp' src/app`
6. **Expected:** All commands return exit code 1 (no matches). Zero inline duplicate definitions remain.

### 3. TypeScript compilation passes

1. Run `pnpm exec tsc --noEmit`
2. **Expected:** Exits 0 with no output. All import paths resolve, all type signatures match.

### 4. ESLint passes

1. Run `pnpm exec eslint src/`
2. **Expected:** Exits 0. No unused imports, no lint errors from the refactoring.

### 5. Consumer files import from shared modules

1. Run `rg "from.*@/lib/pipeline-status" src/app src/components`
2. **Expected:** Matches in `pipelines/page.tsx`, `pipelines/[id]/page.tsx`, `page.tsx` (dashboard), and `custom-view.tsx` — 4 files importing pipeline status utilities.
3. Run `rg "from.*@/lib/format" src/app src/components`
4. **Expected:** Matches in `event-log.tsx`, `status-timeline.tsx`, `node-metrics-charts.tsx`, `node-logs.tsx`, `pipeline-logs.tsx`, and `audit/page.tsx` — at least 6 files importing format utilities.
5. Run `rg "from.*@/lib/status" src/components/fleet`
6. **Expected:** Matches in `event-log.tsx` and `status-timeline.tsx` — 2 files importing status color utilities.

### 6. formatTimeWithSeconds used in log viewers

1. Run `rg 'formatTimeWithSeconds' src/components/fleet/node-logs.tsx src/components/pipeline/pipeline-logs.tsx`
2. **Expected:** Both files import and call `formatTimeWithSeconds` (not `formatTime`), confirming the HH:MM:SS variant is used for log timestamps.

## Edge Cases

### Unused import cleanup

1. Run `rg 'STATUS_COLORS' src/components/fleet/event-log.tsx`
2. **Expected:** No match for `STATUS_COLORS` — only `statusColor` should be imported, since the component never references the constant directly.

### formatTimestamp explicit locale options

1. Run `rg 'year.*month.*day.*hour.*minute.*second' src/lib/format.ts`
2. **Expected:** Match in `formatTimestamp` function — confirms explicit locale options are present (not relying on Intl defaults).

## Failure Signals

- `tsc --noEmit` exits non-zero → an import path is broken or a type signature doesn't match
- `eslint src/` exits non-zero → an unused import was left behind or a new lint issue introduced
- Any grep for inline definitions returns matches → a consumer file wasn't updated
- A consumer file has no import from `@/lib/*` → the wiring was missed

## Not Proven By This UAT

- Runtime behavior equivalence — we verify type signatures match but don't execute the functions with test data
- Visual rendering — no browser checks that formatted timestamps or status colors display correctly
- Performance — no measurement that shared module imports affect bundle size or load time (expected neutral)

## Notes for Tester

- This is a pure refactoring slice. If all static checks pass, the risk of runtime regression is extremely low — the functions were copied verbatim from their original locations.
- The `formatTimestamp` locale options change is the only behavioral delta — it now uses explicit options instead of Intl defaults. On most locales this produces identical output, but edge-case locales could show minor formatting differences on the audit page.
