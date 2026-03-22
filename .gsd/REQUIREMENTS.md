# Requirements

This file is the explicit capability and coverage contract for the project.

## Active

### R001 — Zero TypeScript errors
- Class: quality-attribute
- Status: active
- Description: `tsc --noEmit` must pass with zero errors. Currently 8 errors: stale Prisma client fields in `event-log.tsx` destructuring, missing `monaco-editor` type resolution in `vrl-editor.tsx` and `vrl-language.ts`.
- Why it matters: Type errors indicate schema drift and broken contracts — they mask real bugs and make refactoring unsafe.
- Source: execution
- Primary owning slice: M001/S01
- Supporting slices: none
- Validation: unmapped
- Notes: Prisma generate fixes most errors; remaining are event-log destructuring bug and monaco-editor module resolution.

### R002 — Foundational test coverage for critical paths
- Class: quality-attribute
- Status: active
- Description: Test suite exists with coverage for auth flows (login, 2FA, OIDC), pipeline CRUD, deploy operations, and alert evaluation. Test runner configured and passing in CI.
- Why it matters: Zero tests on a product with enterprise security features is a liability. Critical paths need automated verification before further feature work.
- Source: user
- Primary owning slice: M001/S04
- Supporting slices: none
- Validation: unmapped
- Notes: Need to set up test infrastructure from scratch — runner, Prisma mocking strategy, test utilities.

### R003 — No source file over ~800 lines
- Class: quality-attribute
- Status: active
- Description: All `.ts`/`.tsx` source files (excluding generated code) should be under ~800 lines. Currently 10+ files over 600 lines, with the alerts page at 1910 lines.
- Why it matters: Large monolithic files are hard to navigate, review, and maintain. They signal mixed concerns that should be separated.
- Source: user
- Primary owning slice: M001/S02
- Supporting slices: none
- Validation: unmapped
- Notes: Biggest offenders: alerts page (1910), vrl function-registry (1775), pipeline router (1318), dashboard router (1074), flow-store (951), team-settings (865), users-settings (813), vrl-editor (795).

### R004 — Duplicated utilities extracted to shared modules
- Class: quality-attribute
- Status: active
- Description: Utility functions duplicated across files (e.g., `aggregateProcessStatus` in 3 files, `derivePipelineStatus` in dashboard page) are extracted to shared modules in `src/lib/`.
- Why it matters: Duplicated logic drifts over time and creates maintenance burden.
- Source: execution
- Primary owning slice: M001/S01
- Supporting slices: M001/S02
- Validation: unmapped
- Notes: Scout found `aggregateProcessStatus` in pipelines/page.tsx, pipelines/[id]/page.tsx, and dashboard page.tsx.

### R005 — Consistent loading/empty/error states across all pages
- Class: primary-user-loop
- Status: active
- Description: All 35+ dashboard pages have consistent loading skeletons, empty state messaging with CTAs, and error handling. No page should show a blank white screen during loading or when data is empty.
- Why it matters: Inconsistent loading/empty states make the product feel unfinished and confuse users.
- Source: user
- Primary owning slice: M001/S03
- Supporting slices: none
- Validation: unmapped
- Notes: Most pages already have Skeleton loading — need to audit for gaps and standardize the pattern.

### R006 — UI consistency sweep — visual rough edges cleaned
- Class: primary-user-loop
- Status: active
- Description: General UI polish pass — consistent spacing, typography, icon usage, button patterns, table styles, dialog patterns, and visual consistency across all dashboard pages.
- Why it matters: Visual inconsistencies undermine trust in a product aimed at infrastructure teams.
- Source: user
- Primary owning slice: M001/S03
- Supporting slices: none
- Validation: unmapped
- Notes: General sweep based on code audit — no specific user-reported pain points.

### R007 — Inline router business logic extracted to services
- Class: quality-attribute
- Status: active
- Description: Complex business logic currently inline in tRPC router handlers is extracted to service modules in `src/server/services/`. Routers become thin orchestration layers.
- Why it matters: Inline logic in routers is harder to test, reuse, and reason about. Service extraction enables R002 (testability).
- Source: inferred
- Primary owning slice: M001/S02
- Supporting slices: M001/S04
- Validation: unmapped
- Notes: Pipeline router (1318 lines) and dashboard router (1074 lines) are the primary targets. Some routers already delegate to services well.

### R008 — Clean lint pass
- Class: quality-attribute
- Status: active
- Description: `eslint` runs clean with no errors across the codebase.
- Why it matters: Lint errors signal code quality issues and should be addressed alongside TS errors.
- Source: inferred
- Primary owning slice: M001/S01
- Supporting slices: none
- Validation: unmapped
- Notes: ESLint config uses next/core-web-vitals and next/typescript presets.

### R010 — Performance audit — bundle size, runtime perf, query efficiency
- Class: quality-attribute
- Status: active
- Description: Analyze Next.js bundle size, identify large dependencies or unnecessary client-side imports, review Prisma query patterns for N+1 or missing indexes, and address measurable bottlenecks found.
- Why it matters: Performance issues compound as the product grows — catching them now prevents worse problems later.
- Source: user
- Primary owning slice: M001/S05
- Supporting slices: none
- Validation: unmapped
- Notes: Includes bundle analysis, Prisma query review, and runtime profiling of heavy pages (dashboard, pipeline editor, fleet).

## Validated

(none yet)

## Deferred

### R009 — Build succeeds without ignoreBuildErrors workaround
- Class: quality-attribute
- Status: deferred
- Description: Remove `ignoreBuildErrors: true` from `next.config.ts` so `next build` type-checks without bypassing errors.
- Why it matters: The workaround exists because Next.js build checker diverges from `tsc` on complex intersection types. Removing it would catch errors earlier.
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: Lower priority — `tsc --noEmit` in CI catches real errors. The config comment explains the divergence is in contextual typing through complex intersection types, causing false positives.

## Out of Scope

### R011 — Accessibility audit (WCAG compliance)
- Class: quality-attribute
- Status: out-of-scope
- Description: Full accessibility audit and remediation
- Why it matters: Prevents scope creep — accessibility is a separate focused effort
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Future milestone candidate

### R012 — New feature development
- Class: constraint
- Status: out-of-scope
- Description: No new features are added in this milestone — purely quality improvements to existing functionality
- Why it matters: Prevents scope creep during a quality-focused milestone
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: New features belong in subsequent milestones

## Traceability

| ID | Class | Status | Primary owner | Supporting | Proof |
|---|---|---|---|---|---|
| R001 | quality-attribute | active | M001/S01 | none | unmapped |
| R002 | quality-attribute | active | M001/S04 | none | unmapped |
| R003 | quality-attribute | active | M001/S02 | none | unmapped |
| R004 | quality-attribute | active | M001/S01 | M001/S02 | unmapped |
| R005 | primary-user-loop | active | M001/S03 | none | unmapped |
| R006 | primary-user-loop | active | M001/S03 | none | unmapped |
| R007 | quality-attribute | active | M001/S02 | M001/S04 | unmapped |
| R008 | quality-attribute | active | M001/S01 | none | unmapped |
| R009 | quality-attribute | deferred | none | none | unmapped |
| R010 | quality-attribute | active | M001/S05 | none | unmapped |
| R011 | quality-attribute | out-of-scope | none | none | n/a |
| R012 | constraint | out-of-scope | none | none | n/a |

## Coverage Summary

- Active requirements: 9
- Mapped to slices: 9
- Validated: 0
- Unmapped active requirements: 0
