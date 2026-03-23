# S05 Performance Audit Report

**Date:** 2026-03-23
**Scope:** Client bundle size analysis and server-side Prisma query patterns
**Milestone:** M001

## Summary

This audit examined VectorFlow's client-side bundle composition and server-side Prisma query patterns to identify measurable performance bottlenecks. Two concrete issues were found and fixed: a Prisma client runtime leak into the browser bundle via a non-type-only enum import, and a full-table scan in the dashboard `nodeCards` query. A bundle analyzer was installed for ongoing monitoring. The codebase's query patterns are generally well-structured — no N+1 loops were found, dashboard queries already use `Promise.all` for parallelism, and analytics queries are properly bounded. Three deferred recommendations are documented below for future work.

## Bundle Analysis

### Tooling Setup

`@next/bundle-analyzer@16.2.1` was installed and wired into `next.config.ts` as a conditional wrapper activated by `ANALYZE=true`. Since Next.js 16 defaults to Turbopack, the webpack-based analyzer does not produce `.next/analyze/*.html` reports under the default build. Reports require `ANALYZE=true pnpm build --webpack` or the future `next experimental-analyze` (Turbopack-native alternative). The build itself completes successfully under both Turbopack and webpack modes.

### Fix: Prisma Client Runtime Leak (`import type`)

**File:** `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx`

The `"use client"` component imported `{ AlertMetric, AlertCondition }` as runtime values from `@/generated/prisma`. These symbols are only used as type casts (`as AlertMetric`, `as AlertCondition`), never as runtime values. The runtime import caused the Prisma client module to be included in the browser bundle.

**Fix applied:** Changed to `import type { AlertMetric, AlertCondition }` from `@/generated/prisma`. This eliminates the Prisma client from the browser bundle while preserving type safety.

**Guard:** `rg -F 'import { AlertMetric' src/` must return 0 matches. Any future non-type import of Prisma enums in client components would reintroduce the leak.

### Acceptable Client Dependencies

The following client-bundled libraries were reviewed and found acceptable:

| Library | Location | Size | Rationale |
|---------|----------|------|-----------|
| `recharts` (via `import * as RechartsPrimitive`) | `src/components/ui/chart.tsx` | ~250KB | shadcn/ui standard pattern; wildcard import is how the wrapper component surfaces all chart primitives. Not actionable without replacing the charting library entirely. |
| `js-yaml` | `src/lib/config-generator/importer.ts`, `yaml-generator.ts` → `src/components/flow/flow-toolbar.tsx` | ~108KB | Functionally required for YAML import/export in the visual pipeline editor. Could be dynamically imported if usage is infrequent, but this is a core workflow feature. |
| `diff` | `src/components/ui/config-diff.tsx` | ~30KB | Used for visual config diffing in the deployment flow. Acceptable size for the functionality provided. Could be lazily loaded since diffing is triggered on demand. |
| `qrcode` | `src/app/(auth)/setup-2fa/page.tsx`, `src/components/totp-setup-card.tsx` | ~25KB | Only loaded on 2FA setup pages. Small, isolated to auth flow, acceptable. |

## Prisma Query Patterns

### Fix: `allComponentNodes` Full-Table Scan

**File:** `src/server/routers/dashboard.ts` — `nodeCards` procedure

The `allComponentNodes` query previously executed `findMany()` with no `where` clause, fetching every `PipelineNode` row in the database. This is a full-table scan that scales linearly with total pipeline nodes across all users.

**Fix applied:** Extracted distinct pipeline IDs from the already-fetched `nodes[].pipelineStatuses[].pipeline.id` array and added `where: { pipelineId: { in: pipelineIds } }`. Returns an empty array when no pipelines are found, avoiding unnecessary database round-trips.

**Impact:** Query now scopes to only the pipelines visible to the current user, reducing data transfer proportionally to the user's pipeline count vs. total system pipelines.

### Missing Database Indexes

**Models:** `PipelineNode`, `PipelineEdge`

Both models have a `pipelineId` foreign key column used in `where` clauses, but neither has an `@@index([pipelineId])` directive:

- `PipelineNode` — has `@@index([sharedComponentId])` but no `@@index([pipelineId])`
- `PipelineEdge` — has no `@@index` directives at all

**Recommendation:** Add `@@index([pipelineId])` to both models in the next schema migration. This would improve query performance for all pipeline-scoped lookups (dashboard nodeCards, graph save/load, etc.).

**Status:** Deferred — M001 constraint prohibits schema migrations. Documented as the highest-priority deferred optimization.

### `saveGraphComponents` — `Promise.all(create)` Pattern

**File:** `src/server/services/pipeline-graph.ts`

The `saveGraphComponents` function creates nodes and edges using `Promise.all(nodes.map(node => tx.pipelineNode.create({...})))` instead of Prisma's `createMany`. This was evaluated for conversion but is **not convertible** because the `data` object uses a conditional ID spread:

```typescript
...(node.id ? { id: node.id } : {})
```

Prisma's `createMany` requires uniform data shapes across all records — it cannot handle per-record conditional fields. The current pattern is correct and necessary.

### Other Findings

- **No N+1 query loops:** Searched the entire codebase for patterns where queries execute inside loops. No N+1 patterns were found.
- **Dashboard parallelism:** The dashboard router already uses `Promise.all` to execute independent queries concurrently (e.g., pipeline stats, node cards, volume analytics run in parallel).
- **`volumeAnalytics` bounded query:** This query fetches time-series data with a configurable range (1h to 30d). While the 30-day range could return many rows, the query uses a `since` timestamp filter that bounds the scan. The design is correct and well-bounded.

## Fixes Applied

| # | Change | File | Impact |
|---|--------|------|--------|
| 1 | `import { AlertMetric, AlertCondition }` → `import type { ... }` | `alert-rules-section.tsx` | Eliminates Prisma client runtime from browser bundle |
| 2 | Added `where: { pipelineId: { in: pipelineIds } }` to `allComponentNodes` | `dashboard.ts` | Eliminates full-table scan, scopes to user's pipelines |
| 3 | Installed `@next/bundle-analyzer`, wired into `next.config.ts` | `next.config.ts`, `package.json` | Enables ongoing bundle size monitoring via `ANALYZE=true pnpm build --webpack` |

## Deferred Recommendations

Prioritized by expected impact:

| Priority | Recommendation | Effort | Blocked By |
|----------|---------------|--------|------------|
| **P1** | Add `@@index([pipelineId])` to `PipelineNode` and `PipelineEdge` models | Low (schema change + migration) | M001 no-migration constraint |
| **P2** | Dynamic import for `js-yaml` in `flow-toolbar.tsx` — load on demand when user triggers YAML import/export | Medium (async loading UX) | None — can be done anytime |
| **P3** | Lazy load `diff` library in `config-diff.tsx` — only needed when user views config diffs | Low (dynamic import) | None — can be done anytime |

## Verification

All changes pass type checking and linting:

- `pnpm exec tsc --noEmit` — exits 0 (no type regressions)
- `pnpm exec eslint src/` — exits 0 (no lint regressions)
- `rg -F 'import { AlertMetric' src/` — returns no matches (Prisma leak fixed)
- `rg 'allComponentNodes' src/server/routers/dashboard.ts` — shows `where` clause with `pipelineId` (scoped query)
- `grep '@next/bundle-analyzer' package.json` — present in devDependencies
