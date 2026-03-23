# S05: Performance Audit & Optimization — Research

**Date:** 2026-03-23
**Depth:** Targeted

## Summary

S05 owns R010 (performance audit). The codebase is in good shape — no glaring N+1 query loops, heavy libraries are reasonably scoped, and the Prisma schema has solid indexing. The work breaks into three tasks: (1) set up `@next/bundle-analyzer` and produce a bundle report, (2) audit and fix Prisma query patterns, (3) fix measurable client bundle issues. The findings are concrete and bounded — no speculative refactoring.

**Key findings from exploration:**

- **Bundle:** One `"use client"` component (`alert-rules-section.tsx`) does a value import of Prisma enums (`AlertMetric`, `AlertCondition`), which can pull Prisma client runtime into the browser bundle. `chart.tsx` uses `import * as RechartsPrimitive` (shadcn pattern — limited tree-shaking impact). Monaco editor is already dynamically imported. `config-generator` (uses `js-yaml` and `@dagrejs/dagre`) is imported in client-side `flow-toolbar.tsx` — `js-yaml` is 108KB unminified. `diff` library is in client `config-diff.tsx`. `qrcode` in 2FA pages is client-side but only on auth pages (acceptable).

- **Prisma queries:** `PipelineNode` and `PipelineEdge` have NO `@@index([pipelineId])` — they're queried by `pipelineId` in `saveGraphComponents` (deleteMany + findMany), `pipelineCards`, and `copy-pipeline-graph`. The `nodeCards` endpoint does a full table scan of `PipelineNode` (no where clause) to build a componentKey→kind map — this is wasteful and could be scoped. The `saveGraphComponents` function uses `Promise.all(nodes.map(tx.create))` where `createManyAndReturn` would reduce round-trips. Dashboard queries that could be parallelized are already parallelized via `Promise.all`.

- **Query patterns:** `volumeAnalytics` fetches up to 50,000 `PipelineMetric` rows and buckets them in JS — this is already capped and well-designed. The `chartMetrics` endpoint is the most complex with cross-filtering between nodes and pipelines, but it uses `Promise.all` for parallel queries. No sequential N+1 loops were found anywhere.

## Recommendation

Three tasks in sequence:

1. **Bundle analysis report** — Install `@next/bundle-analyzer`, configure `next.config.ts`, run `ANALYZE=true next build`, capture report. This produces the artifact R010 requires.
2. **Prisma query fixes** — Add `@@index([pipelineId])` to `PipelineNode` and `PipelineEdge`. Scope the `allComponentNodes` query in `nodeCards` to the user's nodes. Convert `Promise.all(nodes.map(create))` to `createManyAndReturn` in `saveGraphComponents`. These are the only measurable database bottlenecks found.
3. **Client bundle fixes** — Change `import { AlertMetric, AlertCondition }` to `import type` in `alert-rules-section.tsx` (prevents Prisma client leaking to browser). Note other findings (recharts wildcard, js-yaml in flow toolbar) in the report but don't change them — they're either shadcn patterns or functionally required.

**Important scope boundary:** The Prisma schema changes (adding indexes) are explicitly listed as out of scope in M001-CONTEXT.md ("no migrations in this milestone"). The planner should note these as recommendations in the report but NOT create a migration. The `import type` fix and `allComponentNodes` scoping are safe refactors that don't require migrations.

## Implementation Landscape

### Key Files

- `next.config.ts` — needs `@next/bundle-analyzer` wrapper (dev dependency + conditional config)
- `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx` — line 1: `import { AlertMetric, AlertCondition } from "@/generated/prisma"` should be `import type`
- `src/server/routers/dashboard.ts` — line 164: `allComponentNodes` full-table scan; should be scoped to relevant pipeline IDs or use the already-fetched `nodes[].pipelineStatuses` data
- `src/server/services/pipeline-graph.ts` — lines 123-147: two `Promise.all(nodes.map(create))` patterns that could use `createManyAndReturn`
- `prisma/schema.prisma` — `PipelineNode` and `PipelineEdge` missing `@@index([pipelineId])` (note for report, don't migrate)
- `src/components/ui/chart.tsx` — `import * as RechartsPrimitive` (shadcn pattern, note only)
- `src/lib/config-generator/` — `js-yaml` (~108KB) imported by client-side `flow-toolbar.tsx` via this module (note only — functionally required for YAML import/export in the visual editor)

### Build Order

1. **T01: Bundle analysis setup & report** — Install `@next/bundle-analyzer` as devDep, wrap `next.config.ts`, run analysis build, capture output as the formal report artifact. This satisfies the "bundle analysis report generated" criterion. Do the Prisma enum import fix here too since it's a one-line change that should show up as a win in the report.
2. **T02: Prisma query optimization** — Scope the `allComponentNodes` query in `dashboard.ts:nodeCards`. Convert `Promise.all(create)` to `createManyAndReturn` in `pipeline-graph.ts`. Document index recommendations for `PipelineNode.pipelineId` and `PipelineEdge.pipelineId` in the report without creating a migration.
3. **T03: Report finalization** — Write the performance audit report summarizing all findings (bundle, queries, recommendations). This is the deliverable artifact.

Note: T01 depends on a successful `next build`, which takes time. T02 is independent of T01. T03 depends on both.

### Verification Approach

- `pnpm exec tsc --noEmit` exits 0 (no regressions from changes)
- `pnpm exec eslint src/` exits 0
- `ANALYZE=true pnpm build` completes and generates `.next/analyze/` reports
- `rg 'import { AlertMetric' src/` returns 0 matches (all converted to `import type`)
- `rg 'allComponentNodes' src/server/routers/dashboard.ts` shows a scoped query (has `where` clause)
- Bundle analysis report file exists at the expected path

## Constraints

- **No Prisma migrations** — M001-CONTEXT.md explicitly states "no migrations in this milestone". Index recommendations must be documented in the report but NOT applied via `prisma migrate`.
- **No API contract changes** — all optimizations are internal. Router inputs/outputs must remain identical.
- **`ignoreBuildErrors: true`** is set in `next.config.ts` — `next build` may succeed even with type errors, so `tsc --noEmit` remains the authoritative type check.
- **`createManyAndReturn`** requires Prisma 5.14.0+ — the project uses Prisma 7.4.2, so this is available. However, it returns only scalar fields by default (no relations). Since `saveGraphComponents` does a separate `findUniqueOrThrow` with `include` after creates, using `createMany` (without `AndReturn`) is simpler and equivalent.

## Common Pitfalls

- **`@next/bundle-analyzer` with Next.js 16** — The analyzer may need the latest version for compatibility. Use `@next/bundle-analyzer@latest`. The config pattern is: `const withBundleAnalyzer = require('@next/bundle-analyzer')({ enabled: process.env.ANALYZE === 'true' })` wrapping the existing config. Since `next.config.ts` uses ESM, use dynamic import.
- **Prisma enum `import type` in alert-rules-section** — Verified safe: the enums are only used as type casts (`form.metric as AlertMetric`, `form.condition as AlertCondition`), not as runtime values. Converting to `import type` will work. No `Object.values()` or member access patterns exist.
- **`createMany` vs `Promise.all(create)`** — `createMany` doesn't support the `...(node.id ? { id: node.id } : {})` conditional spread pattern used in the current code. If IDs are sometimes provided and sometimes auto-generated, keep `Promise.all` or ensure all nodes always/never have IDs.

## Open Risks

- **`next build` may fail** — The project uses `ignoreBuildErrors: true` which suggests the build might have issues unrelated to this slice. If `next build` fails for non-type-error reasons, the bundle analysis report cannot be generated. Mitigation: attempt the build and document any blockers.
- **`allComponentNodes` scoping** — Verified: componentKey→kind is a stable 1:1 mapping (componentKeys like `http_server` always have the same kind). Scoping to the user's pipeline IDs (extractable from the already-fetched `nodes[].pipelineStatuses[].pipeline.id`) is safe. Alternatively, since the `nodeCards` query already includes `pipelineStatuses` with pipeline info, the pipeline IDs are available without an extra query.
