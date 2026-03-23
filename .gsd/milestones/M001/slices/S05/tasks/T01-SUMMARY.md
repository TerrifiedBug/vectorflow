---
id: T01
parent: S05
milestone: M001
provides:
  - "@next/bundle-analyzer wired into next.config.ts (conditional on ANALYZE=true)"
  - "Prisma client runtime no longer leaks to browser bundle via import type fix"
  - "nodeCards allComponentNodes query scoped to user's pipeline IDs"
key_files:
  - next.config.ts
  - package.json
  - src/app/(dashboard)/alerts/_components/alert-rules-section.tsx
  - src/server/routers/dashboard.ts
key_decisions:
  - "Bundle analyzer uses Turbopack-incompatible webpack plugin — reports require --webpack flag on Next.js 16+"
patterns_established:
  - "Use import type for Prisma enums used only as type casts in client components"
  - "Scope Prisma findMany queries to user-visible entity IDs when the full table is not needed"
observability_surfaces:
  - "ANALYZE=true pnpm build --webpack produces .next/analyze/*.html bundle reports"
  - "rg -F 'import { AlertMetric' src/ should return 0 matches (Prisma leak guard)"
  - "rg 'where.*pipelineId' src/server/routers/dashboard.ts confirms query scoping"
duration: 15m
verification_result: passed
completed_at: 2026-03-23
blocker_discovered: false
---

# T01: Install bundle analyzer, fix client import, and scope nodeCards query

**Installed @next/bundle-analyzer, converted Prisma enum import to type-only, and scoped allComponentNodes query to user's pipeline IDs to eliminate full-table scan**

## What Happened

Applied three concrete performance fixes from the S05 research phase:

1. **Bundle analyzer:** Installed `@next/bundle-analyzer@16.2.1` as a devDependency and wrapped the `next.config.ts` export with `withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" })`. The `ANALYZE=true pnpm build` ran successfully but produced no report because Next.js 16 uses Turbopack by default and the bundle analyzer relies on webpack. Running with `--webpack` flag would produce reports — documented for T02's audit report.

2. **Import type fix:** Changed `import { AlertMetric, AlertCondition }` to `import type { AlertMetric, AlertCondition }` in `alert-rules-section.tsx`. Both symbols are only used as type casts (`as AlertMetric`, `as AlertCondition`), never as runtime values, so this is safe. This prevents the Prisma client runtime from being pulled into the browser bundle.

3. **Query scoping:** In `dashboard.ts:nodeCards`, the `allComponentNodes` query was fetching every row from `PipelineNode`. Scoped it to only the pipelines already visible to the user by extracting distinct pipeline IDs from the `nodes[].pipelineStatuses[].pipeline.id` array and adding a `where: { pipelineId: { in: pipelineIds } }` clause. Returns empty array when no pipelines are found.

## Verification

All six task-level verification checks pass:
- `tsc --noEmit` exits 0 (no type regressions)
- `eslint src/` exits 0 (no lint regressions)
- `rg -F 'import { AlertMetric' src/` returns no matches (Prisma leak fixed)
- `rg -F 'import type { AlertMetric' src/` shows exactly the one match in alert-rules-section.tsx (plus an existing one in event-alerts.ts)
- `rg 'where.*pipelineId' src/server/routers/dashboard.ts` shows the scoped query
- `grep '@next/bundle-analyzer' package.json` confirms `^16.2.1` in devDependencies

Slice-level checks for T01 scope: 4/7 pass (remaining 3 are T02 deliverables — S05-REPORT.md file and section counts).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | 6.3s |
| 2 | `pnpm exec eslint src/` | 0 | ✅ pass | 7.6s |
| 3 | `rg -F 'import { AlertMetric' src/` | 1 (no matches) | ✅ pass | <1s |
| 4 | `rg -F 'import type { AlertMetric' src/` | 0 | ✅ pass | <1s |
| 5 | `rg 'where.*pipelineId' src/server/routers/dashboard.ts` | 0 | ✅ pass | <1s |
| 6 | `grep '@next/bundle-analyzer' package.json` | 0 | ✅ pass | <1s |
| 7 | `ANALYZE=true pnpm build` | 0 | ✅ pass (build ok, no report — Turbopack) | 16s |

## Diagnostics

- **Bundle analysis:** Run `ANALYZE=true pnpm build --webpack` to generate `.next/analyze/*.html` reports (requires webpack mode due to Turbopack default in Next.js 16).
- **Prisma import guard:** `rg -F 'import { AlertMetric' src/` — should always return 0 matches. If matches reappear, Prisma client runtime may leak to browser bundle.
- **Query scoping:** `rg 'allComponentNodes' src/server/routers/dashboard.ts` — the query must show a `where` clause with `pipelineId`. If absent, it's a full-table scan regression.

## Deviations

- The `ANALYZE=true pnpm build` succeeded but produced no bundle report files because Next.js 16 defaults to Turbopack, which is incompatible with the webpack-based `@next/bundle-analyzer` plugin. The plugin is correctly installed and wired — it just needs `--webpack` flag to produce output. This is a documentation note for T02, not a blocker.

## Known Issues

- Next.js 16 Turbopack default means `ANALYZE=true pnpm build` silently skips analysis. Use `ANALYZE=true pnpm build --webpack` or `next experimental-analyze` (Turbopack-native alternative). To be documented in S05-REPORT.md.

## Files Created/Modified

- `next.config.ts` — Added `@next/bundle-analyzer` import and wrapped export with `withBundleAnalyzer` conditional on `ANALYZE=true`
- `package.json` — Added `@next/bundle-analyzer` to devDependencies
- `pnpm-lock.yaml` — Updated lockfile with 16 new packages
- `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx` — Changed `import { AlertMetric, AlertCondition }` to `import type { AlertMetric, AlertCondition }`
- `src/server/routers/dashboard.ts` — Scoped `allComponentNodes` query to user's pipeline IDs with `where: { pipelineId: { in: pipelineIds } }`
- `.gsd/milestones/M001/slices/S05/S05-PLAN.md` — Added Observability/Diagnostics section and failure-path diagnostic verification check
- `.gsd/milestones/M001/slices/S05/tasks/T01-PLAN.md` — Added Observability Impact section
