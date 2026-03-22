# S02: Router & Component Refactoring — Research

**Date:** 2026-03-22
**Status:** Ready for planning
**Depth:** Targeted — known patterns applied to known code, moderate complexity from volume

## Summary

S02 targets R003 (no file over ~800 lines), R007 (extract router logic to services), and must maintain R001 (`tsc --noEmit` exits 0) and R008 (`eslint src/` exits 0). Both `tsc` and `eslint` pass clean in the worktree as of research time.

There are **5 files that must be split** (over 800 lines, non-exempt): `alerts/page.tsx` (1910), `pipeline.ts` router (1318), `dashboard.ts` router (1074), `team-settings.tsx` (865), and `users-settings.tsx` (813). Two files are borderline (710-795) and can be addressed if bandwidth allows. Two files are **exempt**: `flow-store.ts` (951 lines, cohesive Zustand store — splitting would create artificial boundaries) and `function-registry.ts` (1775 lines, declarative data — already exempt per D003).

The codebase already has a well-established service extraction pattern in `src/server/services/` (35+ service modules, all using direct function exports with `prisma` imports). The alerts page already has 4 clearly-separated sections with comment headers. The settings `_components/` directory pattern exists and can be extended to alerts. This is straightforward refactoring with known patterns — the main risk is volume, not complexity.

## Recommendation

Split the work into 4 tasks by dependency order:

1. **Alerts page split** — Highest ROI: 1910→~100 lines in the page file, 4 independent components extracted. Zero risk of hidden coupling since each section is already self-contained with its own hooks, mutations, and state.

2. **Pipeline router service extraction** — Extract the 3 heaviest inline handlers (`saveGraph`, `promote`, `discardChanges`) into `src/server/services/pipeline-graph.ts`. This brings the router from 1318 to ~800 lines. The router already delegates to existing services for versions/rollback — extend that pattern.

3. **Dashboard router service extraction** — Extract `chartMetrics` (~360 lines of time-series computation), `nodeCards` data assembly, and `pipelineCards` data assembly into `src/server/services/dashboard-data.ts`. This brings the router from 1074 to ~500 lines.

4. **Settings components split** — Extract dialog sub-components from `team-settings.tsx` and `users-settings.tsx` into sibling files. These are only slightly over 800 lines, so extracting 2-3 dialogs each will bring them under target.

## Implementation Landscape

### Key Files

**Must split (over 800 lines):**

- `src/app/(dashboard)/alerts/page.tsx` (1910 lines) — 4 independent sections: `AlertRulesSection` (L144-630, ~486 lines), `NotificationChannelsSection` (L742-1324, ~582 lines + helpers at L671-741), `WebhooksSection` (L1339-1721, ~382 lines), `AlertHistorySection` (L1724-1875, ~151 lines). Constants/types at L65-142 are shared across sections. The main `AlertsPage` export (L1878-1910) is a thin wrapper composing the 4 sections with `<Separator>`.

- `src/server/routers/pipeline.ts` (1318 lines) — 25 tRPC procedures. Already delegates to `pipeline-version.ts`, `copy-pipeline-graph.ts`, `config-crypto.ts`, `strip-env-refs.ts`, `git-sync.ts`, `sli-evaluator.ts`, `push-registry.ts`. The heaviest inline logic: `saveGraph` (L683-825, 142 lines — shared component validation + node/edge transaction), `promote` (L559-682, 123 lines — cross-environment pipeline copy with secret stripping), `discardChanges` (L826-911, 85 lines — version restore). Zod schemas at top (L25-52) are local to this router.

- `src/server/routers/dashboard.ts` (1074 lines) — 12 tRPC procedures. The `chartMetrics` endpoint (L604-964, ~360 lines) contains the largest block of inline logic: time-series bucketing, downsampling, CPU/memory delta computation, groupBy aggregation (pipeline/node/aggregate modes). `nodeCards` (L106-251, ~145 lines) and `pipelineCards` (L252-422, ~170 lines) also have substantial inline data assembly. `volumeAnalytics` (L492-603, ~111 lines) has bucketing logic. Custom dashboard views CRUD (L965-1074, ~109 lines) is thin.

- `src/app/(dashboard)/settings/_components/team-settings.tsx` (865 lines) — Single exported `TeamSettings` component with ~12 mutations and multiple inline dialogs (reset password, lock/unlock, remove member, link to OIDC). The members table + dialogs form a natural sub-component.

- `src/app/(dashboard)/settings/_components/users-settings.tsx` (813 lines) — Single exported `UsersSettings` component with ~8 mutations and multiple inline dialogs (assign to team, lock/unlock, reset password, delete user, create user, toggle super admin). Similar structure to team-settings.

**Exempt (do not split):**

- `src/stores/flow-store.ts` (951 lines) — Single Zustand store managing React Flow editor state. All methods operate on shared `nodes`, `edges`, history, and selection state. Splitting would require cross-store synchronization, adding complexity without reducing coupling. Decision D002 confirmed "moderate" refactoring depth.

- `src/lib/vrl/function-registry.ts` (1775 lines) — Purely declarative data definitions. Already exempt per D003.

**Borderline (address if bandwidth allows):**

- `src/components/vrl-editor/vrl-editor.tsx` (795 lines) — Under 800, leave as-is.
- `src/server/routers/alert.ts` (710 lines) — Under 800, leave as-is.

### Existing Service Pattern

The project has 35+ service modules in `src/server/services/`. Pattern:
- Pure function exports (no classes, no DI)
- Import `prisma` from `@/lib/prisma` directly
- Import types from `@/generated/prisma`
- Throw `TRPCError` for error cases (coupling to tRPC is established convention)
- Example: `pipeline-version.ts` (170 lines) exports `createVersion`, `listVersions`, `getVersion`, `rollback`

### Alerts Page Split Pattern

The settings directory already uses a `_components/` pattern. For alerts:
- Create `src/app/(dashboard)/alerts/_components/` directory
- Extract each section into its own file: `alert-rules-section.tsx`, `notification-channels-section.tsx`, `webhooks-section.tsx`, `alert-history-section.tsx`
- Shared constants/types go in `_components/constants.ts`
- The main `page.tsx` becomes a thin composition (~50 lines)

### Build Order

1. **Alerts page split (T01)** — Independent, no downstream coupling. The 4 sections are completely self-contained (each has its own tRPC queries, mutations, state). Extract constants to shared file, then move each section. Verify with `tsc --noEmit`.

2. **Pipeline router → service extraction (T02)** — Extract `saveGraph` validation+transaction, `promote` cross-env logic, and `discardChanges` restore logic into `src/server/services/pipeline-graph.ts`. These handlers don't share state with other endpoints. Verify with `tsc --noEmit`.

3. **Dashboard router → service extraction (T03)** — Extract `chartMetrics` computation (the biggest win — 360 lines of pure data transformation), `nodeCards` assembly, and `pipelineCards` assembly into `src/server/services/dashboard-data.ts`. The `chartMetrics` handler contains utility functions (`addPoint`, `downsample`, `avgSeries`, `sumSeries`) that belong in the service. Verify with `tsc --noEmit`.

4. **Settings components split (T04)** — Extract member management dialogs from `team-settings.tsx` and user management dialogs from `users-settings.tsx`. These share mutation hooks with the parent, so the extracted components will receive callbacks as props. This task has the most UI coupling — do it last so earlier tasks are verified clean.

Tasks 1-3 are fully independent of each other and can run in parallel if desired. Task 4 is also independent but lower priority.

### Verification Approach

After each task:
1. `pnpm exec tsc --noEmit` exits 0
2. `pnpm exec eslint src/` exits 0

After all tasks:
3. `find src -name '*.ts' -o -name '*.tsx' | xargs wc -l | sort -rn | head -20` — confirm no non-exempt file exceeds ~800 lines
4. `wc -l src/server/routers/pipeline.ts src/server/routers/dashboard.ts` — both under ~800
5. `wc -l src/app/(dashboard)/alerts/page.tsx` — under ~200

## Constraints

- **No API contract changes** — router refactoring is internal only. Service functions receive the same inputs and return the same outputs as the inline handlers.
- **tRPC middleware stays in routers** — `.use(withTeamAccess())`, `.use(withAudit())`, and `.use(requireSuperAdmin())` remain on the router procedure definitions. Only the handler body (`async ({ input, ctx }) => { ... }`) moves to service functions.
- **`ctx` access** — Some handlers read `ctx.session.user?.id`. Service functions should accept `userId` as a parameter rather than receiving the full `ctx` object, keeping them context-agnostic.
- **Audit metadata** — `saveGraph` sets `ctx.auditMetadata` directly. This side-effect must remain in the router handler; the service function returns the data, the router sets the metadata.

## Common Pitfalls

- **Circular imports from constants** — When extracting alert constants to `_components/constants.ts`, ensure types like `RuleFormState` and `ChannelFormState` are co-located with their section components (not in the shared constants file) to avoid pulling in section-specific dependencies.
- **Dashboard `metricStore` import** — `dashboard.ts` imports `metricStore` (a singleton in-memory metric store). The service extraction must pass `metricStore.getLatestAll()` results as a parameter to the extracted function, not import `metricStore` in the service — the service layer should remain stateless.
- **Prisma transaction context (`tx`)** — `saveGraph` and `discardChanges` use `prisma.$transaction(async (tx) => { ... })`. The extracted service function should accept the transaction client as a parameter so the transaction boundary stays in the service but the `tx` vs `prisma` choice is explicit. Follow the pattern in `copy-pipeline-graph.ts` which takes a `tx` parameter.

## Open Risks

- **`team-settings.tsx` and `users-settings.tsx` dialog extraction complexity** — These components share many mutation hooks and state variables between the table and its dialogs. Extracting dialogs means threading 3-5 callbacks per dialog as props. If the prop drilling makes the code harder to read than the current monolith, consider keeping them slightly over 800 lines. The ~800 target is a guideline, not a hard line.
