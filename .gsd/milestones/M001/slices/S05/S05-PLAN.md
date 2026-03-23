# S05: Performance Audit & Optimization

**Goal:** Produce a performance audit report covering bundle size analysis and Prisma query patterns, fix measurable client-side and query bottlenecks found during the audit.
**Demo:** Bundle analysis report exists with actionable findings. `import type` fix prevents Prisma client leaking to browser bundle. `allComponentNodes` query is scoped to relevant pipelines instead of full-table scan. `tsc --noEmit` and `eslint src/` still exit 0.

## Must-Haves

- `@next/bundle-analyzer` installed and wired into `next.config.ts`
- `ANALYZE=true pnpm build` runs (or build failure is documented)
- `import { AlertMetric, AlertCondition }` converted to `import type` in `alert-rules-section.tsx`
- `allComponentNodes` query in `dashboard.ts:nodeCards` scoped to relevant pipeline IDs
- Performance audit report documenting: bundle analysis findings, Prisma query patterns, index recommendations, addressed vs deferred items
- `tsc --noEmit` exits 0, `eslint src/` exits 0

## Verification

- `pnpm exec tsc --noEmit` exits 0
- `pnpm exec eslint src/` exits 0
- `rg 'import { AlertMetric' src/` returns no matches (all converted to `import type`)
- `rg 'allComponentNodes' src/server/routers/dashboard.ts` shows a `where` clause (scoped query)
- `test -f .gsd/milestones/M001/slices/S05/S05-REPORT.md` — performance audit report exists
- `grep -c "^## " .gsd/milestones/M001/slices/S05/S05-REPORT.md` returns >= 4 (has substantive sections)
- `cat package.json | grep '@next/bundle-analyzer'` — bundle analyzer is installed
- `pnpm exec tsc --noEmit 2>&1 | head -5` — if non-zero, first 5 lines show the regression source (failure-path diagnostic)

## Observability / Diagnostics

- **Bundle analysis:** `ANALYZE=true pnpm build` produces `.next/analyze/*.html` report files when the build succeeds. Presence/absence of these files is the primary diagnostic surface.
- **Import type verification:** `rg 'import { AlertMetric' src/` returns no matches if the Prisma client leak is fixed. If matches are found, the Prisma runtime may still be bundled into the browser.
- **Query scoping:** `rg 'where.*pipelineId' src/server/routers/dashboard.ts` confirms the `allComponentNodes` query is scoped. If absent, the query is a full-table scan.
- **Failure visibility:** If `tsc --noEmit` or `eslint src/` fail after changes, the specific errors point to regressions introduced by the performance fixes. These are the primary failure-path signals.
- **Redaction:** No secrets or user data are involved in this slice — all changes are structural/performance.

## Integration Closure

- Upstream surfaces consumed: `src/server/services/pipeline-graph.ts` (from S02), `src/server/services/dashboard-data.ts` (from S02), `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx` (from S02)
- New wiring introduced in this slice: `@next/bundle-analyzer` conditional wrapper in `next.config.ts`
- What remains before the milestone is truly usable end-to-end: nothing — S05 is the final slice

## Tasks

- [x] **T01: Install bundle analyzer, fix client import, and scope nodeCards query** `est:45m`
  - Why: Addresses the three concrete code-level performance issues found during research — Prisma enum leaking to client bundle, full-table scan in nodeCards, and missing bundle analysis tooling
  - Files: `next.config.ts`, `package.json`, `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx`, `src/server/routers/dashboard.ts`
  - Do: (1) `pnpm add -D @next/bundle-analyzer`, (2) wrap `next.config.ts` export with bundle analyzer conditional on `ANALYZE=true`, (3) change `import { AlertMetric, AlertCondition }` to `import type { AlertMetric, AlertCondition }` in `alert-rules-section.tsx`, (4) scope `allComponentNodes` in `dashboard.ts:nodeCards` to only the pipeline IDs from the already-fetched nodes (extract pipeline IDs from `nodes[].pipelineStatuses[].pipeline.id`), (5) run `ANALYZE=true pnpm build` and capture output — if build fails, document the failure, (6) verify `tsc --noEmit` and `eslint src/` still pass
  - Verify: `pnpm exec tsc --noEmit` exits 0, `pnpm exec eslint src/` exits 0, `rg 'import { AlertMetric' src/` returns no matches, `rg 'where.*pipelineId' src/server/routers/dashboard.ts` shows scoped query
  - Done when: All four code changes applied, type/lint checks pass, bundle analysis attempted

- [x] **T02: Write performance audit report** `est:30m`
  - Why: R010 requires a performance audit report documenting findings and recommendations — this is the formal deliverable artifact for the slice
  - Files: `.gsd/milestones/M001/slices/S05/S05-REPORT.md`
  - Do: Write a structured markdown report covering: (1) Bundle Analysis — report on `@next/bundle-analyzer` output or document build issues, note the `import type` fix and its impact, note `recharts` wildcard import (shadcn pattern, acceptable), note `js-yaml` in flow toolbar (functionally required), note `diff` in config-diff (acceptable), (2) Prisma Query Patterns — document the `allComponentNodes` scoping fix, document missing `@@index([pipelineId])` on PipelineNode and PipelineEdge (recommend adding in future migration), document that `saveGraphComponents` uses `Promise.all(create)` because of conditional ID spreads (not convertible to `createMany`), note that no N+1 loops were found, (3) Recommendations — prioritized list of deferred items, (4) Verification that `tsc --noEmit` and `eslint` still pass. **Constraint:** Do NOT create Prisma migrations — index recommendations are documentation only.
  - Verify: `test -f .gsd/milestones/M001/slices/S05/S05-REPORT.md`, `grep -c "^## " .gsd/milestones/M001/slices/S05/S05-REPORT.md` returns >= 4
  - Done when: Report file exists with sections covering bundle analysis, Prisma patterns, recommendations, and addressed items

## Files Likely Touched

- `next.config.ts`
- `package.json`
- `pnpm-lock.yaml`
- `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx`
- `src/server/routers/dashboard.ts`
- `.gsd/milestones/M001/slices/S05/S05-REPORT.md`
