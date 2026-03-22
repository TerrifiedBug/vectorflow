# M001: Baseline Quality

**Vision:** Establish a clean, maintainable codebase baseline — zero TS errors, refactored large files, consistent UI, foundational tests, and performance audit — before building more features on top.

## Success Criteria

- `tsc --noEmit` exits with zero errors
- `eslint` exits with zero errors
- No source file exceeds ~800 lines (excluding generated code and purely declarative data files)
- Foundational tests pass for auth, pipeline CRUD, deploy, and alert evaluation
- All dashboard pages have consistent loading, empty, and error states
- Bundle analysis report generated with actionable findings addressed
- Duplicated utilities consolidated into shared modules

## Key Risks / Unknowns

- Large file splitting may surface hidden coupling — moderate risk, mitigated by S01 extracting shared utilities first
- Prisma 7 test mocking setup is uncharted for this codebase — some research needed in S04
- Performance audit may open scope — discipline to fix clear wins and note the rest

## Proof Strategy

- Hidden coupling in large files → retire in S02 by splitting files and verifying `tsc --noEmit` still passes
- Prisma test mocking → retire in S04 by setting up test infrastructure and running first test suite
- Performance scope creep → retire in S05 by producing a report and only addressing measurable bottlenecks

## Verification Classes

- Contract verification: `tsc --noEmit`, `eslint`, test suite, `find` for file line counts
- Integration verification: spot-check that refactored pages still render, API contracts unchanged
- Operational verification: none — no runtime behavior changes
- UAT / human verification: visual spot-check of dashboard pages for UI consistency

## Milestone Definition of Done

This milestone is complete only when all are true:

- `tsc --noEmit` exits 0
- `eslint` exits 0
- All foundational tests pass
- No source file over ~800 lines (excluding generated and declarative data)
- Duplicated utilities live in shared modules
- Every dashboard page has loading, empty, and error states
- Bundle analysis report exists with findings addressed
- Visual spot-check confirms consistent UI patterns

## Requirement Coverage

- Covers: R001, R002, R003, R004, R005, R006, R007, R008, R010
- Partially covers: none
- Leaves for later: R009
- Orphan risks: none

## Slices

- [ ] **S01: TypeScript fixes & shared utilities** `risk:low` `depends:[]`
  > After this: `tsc --noEmit` passes with zero errors, `eslint` is clean, duplicated helpers are consolidated into `src/lib/` shared modules.

- [ ] **S02: Router & component refactoring** `risk:medium` `depends:[S01]`
  > After this: All source files are under ~800 lines, router business logic is extracted to service modules, `tsc --noEmit` still passes.

- [ ] **S03: UI consistency sweep** `risk:low` `depends:[S01]`
  > After this: Every dashboard page has consistent loading skeletons, empty states with CTAs, and error handling. Visual rough edges are cleaned up.

- [ ] **S04: Foundational test suite** `risk:medium` `depends:[S01,S02]`
  > After this: Test infrastructure is set up, foundational tests pass for auth flows, pipeline CRUD, deploy operations, and alert evaluation.

- [ ] **S05: Performance audit & optimization** `risk:medium` `depends:[S01,S02]`
  > After this: Bundle analysis report generated, Prisma query patterns reviewed, measurable bottlenecks addressed.

## Boundary Map

### S01 → S02

Produces:
- `src/lib/pipeline-status.ts` → `aggregateProcessStatus()`, `derivePipelineStatus()` (shared status derivation utilities)
- `src/lib/format.ts` → any additional formatting helpers extracted from page files
- Zero TS errors baseline — S02 refactoring can verify against this

Consumes:
- nothing (first slice)

### S01 → S03

Produces:
- Clean type baseline for UI components to build against
- Shared utilities that UI pages can import instead of inline definitions

Consumes:
- nothing (first slice)

### S01 → S04

Produces:
- Clean codebase that tests can import without type errors
- Shared utilities with stable APIs to test against

Consumes:
- nothing (first slice)

### S02 → S04

Produces:
- Service modules extracted from routers — testable units with clear inputs/outputs
- Smaller, focused router files that are easier to test in isolation

Consumes from S01:
- Shared utilities from `src/lib/`
- Zero TS errors baseline

### S02 → S05

Produces:
- Refactored modules with clearer boundaries for profiling
- Service layer separation that makes query patterns easier to audit

Consumes from S01:
- Shared utilities, clean type baseline

### S01 → S05

Produces:
- Clean codebase for accurate bundle analysis (no dead code from duplicates)

Consumes:
- nothing (first slice)
