---
estimated_steps: 5
estimated_files: 5
skills_used:
  - review
  - best-practices
---

# T01: Install bundle analyzer, fix client import, and scope nodeCards query

**Slice:** S05 — Performance Audit & Optimization
**Milestone:** M001

## Description

Address three concrete code-level performance issues found during the S05 research phase: (1) install `@next/bundle-analyzer` and wire it into `next.config.ts` so bundle reports can be generated, (2) fix a Prisma enum value import that leaks the Prisma client runtime into the browser bundle, (3) scope a full-table-scan query to only relevant pipeline IDs.

## Steps

1. **Install `@next/bundle-analyzer`** — Run `pnpm add -D @next/bundle-analyzer`. This is a dev dependency only.

2. **Wire bundle analyzer into `next.config.ts`** — The current config is a simple ESM export:
   ```ts
   import type { NextConfig } from "next";
   const nextConfig: NextConfig = { ... };
   export default nextConfig;
   ```
   Wrap the export with the bundle analyzer. Since `next.config.ts` uses ESM, use:
   ```ts
   import bundleAnalyzer from "@next/bundle-analyzer";
   const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === "true" });
   export default withBundleAnalyzer(nextConfig);
   ```
   Keep the existing config unchanged — only wrap the export.

3. **Fix Prisma enum import in `alert-rules-section.tsx`** — In `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx`, line 1 area has:
   ```ts
   import { AlertMetric, AlertCondition } from "@/generated/prisma";
   ```
   Change to:
   ```ts
   import type { AlertMetric, AlertCondition } from "@/generated/prisma";
   ```
   This is safe because `AlertMetric` and `AlertCondition` are only used as type casts (`form.metric as AlertMetric`, `form.condition as AlertCondition`), never as runtime values (no `Object.values()` or member access). This prevents the Prisma client runtime from being pulled into the browser bundle.

4. **Scope `allComponentNodes` query in `dashboard.ts:nodeCards`** — In `src/server/routers/dashboard.ts`, the `nodeCards` procedure has:
   ```ts
   const allComponentNodes = await prisma.pipelineNode.findMany({
     select: { componentKey: true, kind: true },
   });
   ```
   This is a full-table scan of `PipelineNode`. The query is used to build a `componentKey → kind` map for determining whether a component is a source or sink. Scope it to only the pipelines already visible to this user. The `nodes` array (fetched earlier in the same procedure) includes `pipelineStatuses[].pipeline.id`. Extract the distinct pipeline IDs and use them:
   ```ts
   const pipelineIds = [...new Set(
     nodes.flatMap((n) => n.pipelineStatuses.map((ps) => ps.pipeline.id))
   )];
   const allComponentNodes = pipelineIds.length > 0
     ? await prisma.pipelineNode.findMany({
         where: { pipelineId: { in: pipelineIds } },
         select: { componentKey: true, kind: true },
       })
     : [];
   ```
   The `componentKey → kind` mapping is stable (a given componentKey always maps to the same kind), so scoping to the user's pipelines gives the same result for the downstream `assembleNodeCards` function.

5. **Attempt `ANALYZE=true pnpm build`** — Run the build with the analyzer enabled. Capture the output. If the build succeeds, `.next/analyze/` will contain the report HTML files. If the build fails (the project has `ignoreBuildErrors: true` for TS errors, but other issues may exist), document the failure and any output. Either way, run `pnpm exec tsc --noEmit` and `pnpm exec eslint src/` to verify no regressions from the code changes.

## Must-Haves

- [ ] `@next/bundle-analyzer` installed as devDependency
- [ ] `next.config.ts` wraps config with bundle analyzer, conditional on `ANALYZE=true`
- [ ] `alert-rules-section.tsx` uses `import type` for `AlertMetric` and `AlertCondition`
- [ ] `dashboard.ts:nodeCards` query scoped to user's pipeline IDs (not full-table scan)
- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm exec eslint src/` exits 0

## Verification

- `pnpm exec tsc --noEmit` exits 0
- `pnpm exec eslint src/` exits 0
- `rg 'import { AlertMetric' src/` returns no matches
- `rg 'import type { AlertMetric' src/` returns exactly 1 match in `alert-rules-section.tsx`
- `rg 'where.*pipelineId' src/server/routers/dashboard.ts` shows scoped query near the `allComponentNodes` variable
- `cat package.json | grep '@next/bundle-analyzer'` confirms installation

## Inputs

- `next.config.ts` — existing Next.js config to wrap with bundle analyzer
- `package.json` — current dependencies
- `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx` — has `import { AlertMetric, AlertCondition }` on line ~20 (among imports from `@/generated/prisma`)
- `src/server/routers/dashboard.ts` — has `nodeCards` procedure with unscoped `allComponentNodes` query around line 164

## Expected Output

- `next.config.ts` — modified to conditionally wrap with `@next/bundle-analyzer`
- `package.json` — `@next/bundle-analyzer` added to devDependencies
- `pnpm-lock.yaml` — updated lockfile
- `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx` — `import type` fix applied
- `src/server/routers/dashboard.ts` — `allComponentNodes` query scoped to user's pipeline IDs
