---
estimated_steps: 3
estimated_files: 1
skills_used:
  - review
---

# T02: Write performance audit report

**Slice:** S05 — Performance Audit & Optimization
**Milestone:** M001

## Description

Write the formal performance audit report that satisfies R010. This report documents all findings from the S05 performance audit: bundle analysis results (or build failure notes), Prisma query pattern review, fixes applied, and prioritized recommendations for deferred items. This is the key deliverable artifact for the slice.

## Steps

1. **Gather T01 results** — Check whether `ANALYZE=true pnpm build` succeeded by looking for `.next/analyze/` output. If the build succeeded, examine the client and server bundle reports. If the build failed, note the failure reason. Also verify the code changes from T01 are in place by checking `next.config.ts`, `alert-rules-section.tsx`, and `dashboard.ts`.

2. **Write the report** — Create `.gsd/milestones/M001/slices/S05/S05-REPORT.md` with these sections:
   - **Summary** — One paragraph overview of the audit scope and key findings
   - **Bundle Analysis** — Report on `@next/bundle-analyzer` output:
     - If build succeeded: document the client/server/edge bundle sizes, identify the largest chunks, note any surprising dependencies
     - If build failed: document what went wrong and what partial info is available
     - Document the `import type` fix for `AlertMetric`/`AlertCondition` (prevents Prisma client runtime in browser bundle)
     - Note `import * as RechartsPrimitive` in `src/components/ui/chart.tsx` — this is a shadcn/ui pattern, not actionable
     - Note `js-yaml` (~108KB) imported via `src/lib/config-generator/` into client-side `flow-toolbar.tsx` — functionally required for YAML import/export in visual editor
     - Note `diff` library in `src/components/pipeline/config-diff.tsx` — used for visual config diffing, acceptable
     - Note `qrcode` in 2FA pages — small, only on auth pages, acceptable
   - **Prisma Query Patterns** — Document findings:
     - `allComponentNodes` full-table scan in `nodeCards` — FIXED (scoped to user's pipeline IDs)
     - Missing `@@index([pipelineId])` on `PipelineNode` and `PipelineEdge` models — RECOMMENDED (requires migration, deferred per M001 constraint of no schema migrations)
     - `saveGraphComponents` uses `Promise.all(nodes.map(create))` instead of `createMany` — NOT CONVERTIBLE because of `...(node.id ? { id: node.id } : {})` conditional spread pattern
     - No N+1 query loops found anywhere in the codebase
     - Dashboard queries already use `Promise.all` for parallelism
     - `volumeAnalytics` fetches up to 50,000 rows but is already capped and well-designed
   - **Fixes Applied** — List the concrete changes made in this slice:
     1. `import type` fix in `alert-rules-section.tsx`
     2. `allComponentNodes` query scoping in `dashboard.ts`
     3. `@next/bundle-analyzer` installed and configured
   - **Deferred Recommendations** — Prioritized list:
     1. Add `@@index([pipelineId])` to `PipelineNode` and `PipelineEdge` (next migration)
     2. Consider dynamic import for `js-yaml` in flow toolbar if YAML operations are infrequent
     3. Consider lazy loading `diff` library in config-diff component
   - **Verification** — Confirm `tsc --noEmit` and `eslint src/` still pass after all changes

3. **Final verification** — Run `pnpm exec tsc --noEmit` and `pnpm exec eslint src/` one final time to confirm the entire slice leaves the codebase clean.

## Must-Haves

- [ ] Report file exists at `.gsd/milestones/M001/slices/S05/S05-REPORT.md`
- [ ] Report has sections for: Summary, Bundle Analysis, Prisma Query Patterns, Fixes Applied, Deferred Recommendations
- [ ] Report documents the `import type` fix and `allComponentNodes` scoping
- [ ] Report documents missing `@@index([pipelineId])` recommendations without creating a migration
- [ ] Report notes that `saveGraphComponents` `Promise.all(create)` pattern is not convertible to `createMany`
- [ ] `tsc --noEmit` and `eslint src/` exit 0

## Verification

- `test -f .gsd/milestones/M001/slices/S05/S05-REPORT.md` — report exists
- `grep -c "^## " .gsd/milestones/M001/slices/S05/S05-REPORT.md` returns >= 4
- `grep -q "import type" .gsd/milestones/M001/slices/S05/S05-REPORT.md` — mentions the fix
- `grep -q "@@index" .gsd/milestones/M001/slices/S05/S05-REPORT.md` — mentions index recommendation
- `pnpm exec tsc --noEmit` exits 0
- `pnpm exec eslint src/` exits 0

## Inputs

- `next.config.ts` — T01's bundle analyzer integration (to verify and document)
- `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx` — T01's `import type` fix (to document)
- `src/server/routers/dashboard.ts` — T01's `allComponentNodes` scoping (to document)
- `src/server/services/pipeline-graph.ts` — `saveGraphComponents` pattern (to document)
- `prisma/schema.prisma` — PipelineNode/PipelineEdge index status (to document recommendations)
- `src/components/ui/chart.tsx` — recharts import pattern (to note in report)
- `src/lib/config-generator/` — js-yaml usage (to note in report)

## Expected Output

- `.gsd/milestones/M001/slices/S05/S05-REPORT.md` — the formal performance audit report artifact
