# M001: Baseline Quality

**Gathered:** 2026-03-22
**Status:** Ready for planning

## Project Description

VectorFlow is a self-hosted control plane for Vector.dev data pipelines — visual editor, fleet deployment, monitoring, enterprise auth, alerting. Next.js 16 + tRPC + Prisma + React Flow. The codebase has grown fast with many features but needs a quality baseline pass before further development.

## Why This Milestone

The product works but has accumulated technical debt: 8 TypeScript errors from schema drift, zero tests, several 1000+ line monolithic files, duplicated utilities, and inconsistent UI patterns across 35+ pages. This milestone establishes a clean, maintainable baseline before building more on top.

## User-Visible Outcome

### When this milestone is complete, the user can:

- See consistent loading, empty, and error states across every dashboard page
- Experience a visually polished, consistent interface without rough edges
- Trust that critical paths (auth, pipeline CRUD, deploy) are covered by automated tests

### Entry point / environment

- Entry point: `http://localhost:3000` (Next.js dev server)
- Environment: local dev
- Live dependencies involved: PostgreSQL (Prisma)

## Completion Class

- Contract complete means: zero TS errors, clean lint, all tests passing, no file over ~800 lines, bundle analysis report generated
- Integration complete means: refactored routers still serve the same API contracts, UI changes render correctly
- Operational complete means: none — no runtime behavior changes

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- `tsc --noEmit` exits 0
- `eslint` exits 0
- All tests pass
- `find src -name '*.ts' -o -name '*.tsx' | xargs wc -l | sort -rn | head -1` shows no file over ~800 lines (excluding generated)
- Bundle analysis shows no obvious oversized chunks or unnecessary client imports
- Visual spot-check of dashboard, pipelines, fleet, alerts, settings pages shows consistent patterns

## Risks and Unknowns

- Splitting large files may surface hidden coupling between components and state — moderate risk
- Setting up Prisma test mocking from scratch — some unknowns around the best approach with Prisma 7
- Performance audit findings may open scope — discipline to note issues and only fix clear wins

## Existing Codebase / Prior Art

- `src/server/services/` — existing service layer pattern, some routers already delegate well
- `src/components/ui/` — shadcn/ui component library, well-structured
- `src/lib/` — shared utilities exist but some helpers are duplicated in page files
- `src/stores/flow-store.ts` — 951-line Zustand store, complex but cohesive
- `src/app/(dashboard)/alerts/page.tsx` — 1910 lines, the single largest file
- `src/server/routers/pipeline.ts` — 1318 lines, heaviest router
- `prisma/schema.prisma` — 806 lines, well-structured with proper indexes

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- R001 — Zero TypeScript errors (S01)
- R002 — Foundational test coverage (S04)
- R003 — No file over ~800 lines (S02)
- R004 — Duplicated utilities extracted (S01)
- R005 — Consistent loading/empty/error states (S03)
- R006 — UI consistency sweep (S03)
- R007 — Router logic extracted to services (S02)
- R008 — Clean lint pass (S01)
- R010 — Performance audit (S05)

## Scope

### In Scope

- Fix all TypeScript errors
- Extract duplicated utility functions to shared modules
- Split files over ~800 lines into smaller, focused modules
- Extract inline router business logic to service layer
- Audit and standardize loading/empty/error states across all dashboard pages
- General UI consistency polish
- Set up test infrastructure and write foundational tests for critical paths
- Performance audit — bundle analysis, Prisma query review, runtime profiling
- Fix measurable performance issues found during audit

### Out of Scope / Non-Goals

- New feature development
- Full accessibility (WCAG) audit — future milestone
- Removing `ignoreBuildErrors: true` from next.config (deferred — see R009)
- Changing the Go agent code
- Database schema changes
- Auth flow changes

## Technical Constraints

- Must not change any API contracts — refactoring is internal only
- Prisma schema is stable — no migrations in this milestone
- Monaco editor is loaded dynamically via `@monaco-editor/react` — the type issue is about dev-time resolution, not runtime
- `vrl/function-registry.ts` at 1775 lines is a data file (function definitions) — may be acceptable to leave large if it's purely declarative

## Integration Points

- Prisma/PostgreSQL — needs mocking strategy for tests
- NextAuth v5 beta — auth flow testing
- tRPC — router contracts must remain unchanged after refactoring

## Open Questions

- Best Prisma mocking approach for Prisma 7 — likely `prisma-mock` or manual mocks with dependency injection
- Whether `flow-store.ts` (951 lines) should be split or left as-is given it's a cohesive Zustand store
- Whether `vrl/function-registry.ts` (1775 lines) counts against the 800-line target since it's declarative data
