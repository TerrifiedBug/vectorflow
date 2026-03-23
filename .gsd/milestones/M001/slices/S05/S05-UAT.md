# S05 UAT Script: Performance Audit & Optimization

**Preconditions:**
- Working directory is the project root with `pnpm install` completed
- S01–S04 changes are already applied (shared utilities, refactored routers, UI consistency, test suite)
- Node.js and pnpm available

---

## TC-01: Bundle Analyzer Installation

**Objective:** Verify `@next/bundle-analyzer` is installed and wired correctly.

1. Run `grep '@next/bundle-analyzer' package.json`
   - **Expected:** Shows `"@next/bundle-analyzer": "^16.2.1"` in devDependencies
2. Run `grep -A2 'bundle-analyzer' next.config.ts`
   - **Expected:** Shows import of `@next/bundle-analyzer` and `withBundleAnalyzer` wrapper conditional on `ANALYZE === "true"`
3. Run `ANALYZE=true pnpm build` (Turbopack mode — default)
   - **Expected:** Build succeeds with exit 0. No `.next/analyze/` report files produced (Turbopack caveat).
4. Run `ANALYZE=true pnpm build --webpack` (webpack mode)
   - **Expected:** Build succeeds and produces `.next/analyze/*.html` report files. If build fails due to other issues, the bundle analyzer plugin should still log its activation.

---

## TC-02: Prisma Client Import Type Fix

**Objective:** Verify Prisma enum imports in client components use `import type` to prevent runtime leak.

1. Run `rg -F 'import { AlertMetric' src/`
   - **Expected:** Zero matches. No runtime imports of AlertMetric anywhere in `src/`.
2. Run `rg -F 'import type { AlertMetric' src/`
   - **Expected:** Matches in `alert-rules-section.tsx` and `event-alerts.ts` — both use type-only imports.
3. Open `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx` and search for `AlertMetric`
   - **Expected:** Used only in type cast expressions (`as AlertMetric`, `as AlertCondition`), never called as a function or used as a runtime value.

---

## TC-03: Query Scoping — nodeCards allComponentNodes

**Objective:** Verify the `allComponentNodes` query is scoped to user-visible pipeline IDs.

1. Run `rg -A8 'allComponentNodes' src/server/routers/dashboard.ts`
   - **Expected:** The query includes `where: { pipelineId: { in: pipelineIds } }` — not a bare `findMany({})`.
2. Verify pipelineIds derivation: search for `pipelineIds` assignment above the query
   - **Expected:** Pipeline IDs are extracted from the already-fetched `nodes` array's `pipelineStatuses[].pipeline.id` values.
3. Verify empty pipeline guard: check for early return when `pipelineIds.length === 0`
   - **Expected:** Returns empty array without hitting the database when no pipelines are found.

**Edge case:** If a user has zero pipelines, the query should not execute at all (no unnecessary DB round-trip).

---

## TC-04: Performance Audit Report

**Objective:** Verify the formal performance audit report exists and covers all required sections.

1. Run `test -f .gsd/milestones/M001/slices/S05/S05-REPORT.md && echo OK`
   - **Expected:** `OK`
2. Run `grep -c "^## " .gsd/milestones/M001/slices/S05/S05-REPORT.md`
   - **Expected:** `6` (or more)
3. Verify section topics by running `grep "^## " .gsd/milestones/M001/slices/S05/S05-REPORT.md`
   - **Expected:** Sections covering at minimum: Summary, Bundle Analysis, Prisma Query Patterns, Fixes Applied, Deferred Recommendations, Verification.
4. Run `grep -q "@@index" .gsd/milestones/M001/slices/S05/S05-REPORT.md && echo FOUND`
   - **Expected:** `FOUND` — the report documents the missing index recommendation.
5. Run `grep -q "import type" .gsd/milestones/M001/slices/S05/S05-REPORT.md && echo FOUND`
   - **Expected:** `FOUND` — the report documents the Prisma client leak fix.

---

## TC-05: No Type or Lint Regressions

**Objective:** Confirm S05 changes don't break the codebase contract.

1. Run `pnpm exec tsc --noEmit`
   - **Expected:** Exits 0 with no output.
2. Run `pnpm exec eslint src/`
   - **Expected:** Exits 0 with no warnings or errors.

---

## TC-06: Turbopack Compatibility Documentation

**Objective:** Verify the Turbopack/bundle-analyzer incompatibility is documented.

1. Run `grep -q "webpack" .gsd/milestones/M001/slices/S05/S05-REPORT.md && echo FOUND`
   - **Expected:** `FOUND` — the report mentions the `--webpack` flag requirement.
2. Run `grep -q "Turbopack" .gsd/KNOWLEDGE.md && echo FOUND`
   - **Expected:** `FOUND` — the knowledge base has the Turbopack caveat entry.

---

## Summary Checklist

| TC | Description | Pass Criteria |
|----|-------------|---------------|
| TC-01 | Bundle analyzer installed | package.json + next.config.ts wired |
| TC-02 | Prisma import type fix | 0 runtime imports of AlertMetric |
| TC-03 | Query scoping | where clause with pipelineId, empty guard |
| TC-04 | Audit report | Exists, ≥6 sections, covers key topics |
| TC-05 | No regressions | tsc + eslint exit 0 |
| TC-06 | Turbopack docs | Caveat in report and knowledge base |
