# S02: Router & Component Refactoring

**Goal:** All source files are under ~800 lines (excluding exempt files), router business logic is extracted to service modules, `tsc --noEmit` and `eslint src/` still pass clean.
**Demo:** `find src -name '*.ts' -o -name '*.tsx' | xargs wc -l | sort -rn | head -20` shows no non-exempt file over ~800 lines; `pnpm exec tsc --noEmit` exits 0; `pnpm exec eslint src/` exits 0.

## Must-Haves

- Alerts page split into 4 section components under `src/app/(dashboard)/alerts/_components/`, main `page.tsx` under ~200 lines
- Pipeline router `saveGraph`, `promote`, and `discardChanges` handler logic extracted to `src/server/services/pipeline-graph.ts`; router file under ~800 lines
- Dashboard router `chartMetrics`, `nodeCards`, and `pipelineCards` computation extracted to `src/server/services/dashboard-data.ts`; router file under ~800 lines
- Settings components (`team-settings.tsx`, `users-settings.tsx`) split by extracting dialog sub-components; both under ~800 lines
- `tsc --noEmit` exits 0 after all changes (R001)
- `eslint src/` exits 0 after all changes (R008)
- No API contract changes — all refactoring is internal

## Verification

- `pnpm exec tsc --noEmit` exits 0
- `pnpm exec eslint src/` exits 0
- `wc -l src/app/(dashboard)/alerts/page.tsx` — under 200 lines
- `wc -l src/server/routers/pipeline.ts` — under 850 lines
- `wc -l src/server/routers/dashboard.ts` — under 850 lines
- `wc -l src/app/(dashboard)/settings/_components/team-settings.tsx` — under 800 lines
- `wc -l src/app/(dashboard)/settings/_components/users-settings.tsx` — under 800 lines
- `test -f src/server/services/pipeline-graph.ts` — service file exists
- `test -f src/server/services/dashboard-data.ts` — service file exists
- `test -d src/app/(dashboard)/alerts/_components` — alerts components directory exists
- `find src -name '*.ts' -o -name '*.tsx' | xargs wc -l | sort -rn | head -10` — no non-exempt file over ~800 lines (exempt: `flow-store.ts` per D002, `function-registry.ts` per D003)

## Tasks

- [ ] **T01: Split alerts page into section components** `est:45m`
  - Why: Alerts page is 1910 lines — the largest non-exempt file. It has 4 clearly separated sections (`AlertRulesSection`, `NotificationChannelsSection`, `WebhooksSection`, `AlertHistorySection`) that are already self-contained with their own hooks, mutations, and state. Extracting them is the highest-ROI split in S02.
  - Files: `src/app/(dashboard)/alerts/page.tsx`, `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx`, `src/app/(dashboard)/alerts/_components/notification-channels-section.tsx`, `src/app/(dashboard)/alerts/_components/webhooks-section.tsx`, `src/app/(dashboard)/alerts/_components/alert-history-section.tsx`, `src/app/(dashboard)/alerts/_components/constants.ts`
  - Do: Create `_components/` directory. Extract shared constants/types (L65-142) to `constants.ts` — but keep form-state types (like `RuleFormState`, `ChannelFormState`) co-located with their section components to avoid pulling in section-specific dependencies. Move each section function into its own file with all its local helpers. Thin `page.tsx` to a composition wrapper (~50-100 lines) that imports and renders the 4 sections. Preserve all existing imports in each section file.
  - Verify: `pnpm exec tsc --noEmit` exits 0 && `wc -l src/app/(dashboard)/alerts/page.tsx` under 200
  - Done when: Alerts page under 200 lines, 4 section component files exist, `tsc` and `eslint` pass clean

- [x] **T02: Extract pipeline router business logic to service module** `est:45m`
  - Why: Pipeline router is 1318 lines with 3 heavy inline handlers. The codebase already delegates to services like `pipeline-version.ts` — extending this pattern to `saveGraph`, `promote`, and `discardChanges` brings the router under ~800 lines and advances R007 (thin routers).
  - Files: `src/server/routers/pipeline.ts`, `src/server/services/pipeline-graph.ts`
  - Do: Create `pipeline-graph.ts` following the existing service pattern (direct function exports, import `prisma` from `@/lib/prisma`, throw `TRPCError`). Extract: (1) `saveGraph` validation + transaction logic — accept `tx: Prisma.TransactionClient` parameter, return the saved data, leave `ctx.auditMetadata` assignment in the router; (2) `promote` cross-environment copy logic — accept `userId` as parameter instead of full `ctx`; (3) `discardChanges` version restore logic — accept `tx` parameter. Keep all `.use(withAudit())` and `.use(withTeamAccess())` middleware in the router. Keep Zod schemas in the router file (they're local to the router).
  - Verify: `pnpm exec tsc --noEmit` exits 0 && `wc -l src/server/routers/pipeline.ts` under 850
  - Done when: `pipeline-graph.ts` service exists with 3 exported functions, pipeline router under ~800 lines, `tsc` and `eslint` pass clean

- [ ] **T03: Extract dashboard router computation to service module** `est:45m`
  - Why: Dashboard router is 1074 lines. The `chartMetrics` endpoint alone is 360 lines of pure data transformation (time-series bucketing, downsampling, aggregation). Extracting this plus `nodeCards` and `pipelineCards` assembly brings the router well under 800 lines and produces a testable service module for S04.
  - Files: `src/server/routers/dashboard.ts`, `src/server/services/dashboard-data.ts`
  - Do: Create `dashboard-data.ts` service. Extract: (1) `chartMetrics` computation including `addPoint`, `downsample`, `avgSeries`, `sumSeries` utility functions — accept the DB query results and metric samples as parameters (do NOT import `metricStore` in the service — the router passes `metricStore.getLatestAll()` results in); (2) `nodeCards` data assembly — accept raw DB query results, return assembled card data; (3) `pipelineCards` data assembly — same pattern. The service must remain stateless — all singleton/side-effect access stays in the router.
  - Verify: `pnpm exec tsc --noEmit` exits 0 && `wc -l src/server/routers/dashboard.ts` under 850
  - Done when: `dashboard-data.ts` service exists, dashboard router under ~800 lines, `tsc` and `eslint` pass clean

- [ ] **T04: Extract settings dialog sub-components** `est:30m`
  - Why: `team-settings.tsx` (865 lines) and `users-settings.tsx` (813 lines) are just over the ~800-line target. Each contains multiple inline dialogs that can be extracted to sibling files. This task brings both under target and completes R003 coverage.
  - Files: `src/app/(dashboard)/settings/_components/team-settings.tsx`, `src/app/(dashboard)/settings/_components/users-settings.tsx`, `src/app/(dashboard)/settings/_components/team-member-dialogs.tsx`, `src/app/(dashboard)/settings/_components/user-management-dialogs.tsx`
  - Do: For `team-settings.tsx`: extract dialog components (reset password, lock/unlock, remove member, link to OIDC) into `team-member-dialogs.tsx`. The parent passes mutation callbacks and state as props. For `users-settings.tsx`: extract dialog components (assign to team, lock/unlock, reset password, delete user, create user, toggle super admin) into `user-management-dialogs.tsx`. Same pattern. If prop drilling makes a component harder to read than the monolith, keep that dialog inline — the ~800 target is a guideline (per research risk note). Aim for each parent file under 800 lines but accept ~650-700 as a realistic target.
  - Verify: `pnpm exec tsc --noEmit` exits 0 && `wc -l src/app/(dashboard)/settings/_components/team-settings.tsx src/app/(dashboard)/settings/_components/users-settings.tsx` both under 800
  - Done when: Both settings files under 800 lines, dialog components extracted to sibling files, `tsc` and `eslint` pass clean

## Observability / Diagnostics

This slice is a pure structural refactor — no new runtime signals are introduced and no existing signals are removed. The key observability invariant is **behavioral equivalence**: every tRPC endpoint and UI page must produce the same inputs/outputs, audit log entries, and error responses before and after refactoring.

- **Runtime signals preserved:** All `withAudit()` middleware, `ctx.auditMetadata` assignments, `TRPCError` throws, and `console.error` calls remain in their original call paths. Extracted service functions throw `TRPCError` directly (matching the existing pattern in `pipeline-version.ts`).
- **Inspection surface:** `tsc --noEmit` and `eslint src/` are the primary verification surfaces. Any signature mismatch or missing import is caught at compile time. Line-count checks enforce the file-size constraint.
- **Failure visibility:** If a service extraction breaks an endpoint, the tRPC error boundary will surface it as a 500 with the original error message. The audit middleware logs the procedure name + error, making broken endpoints traceable in the audit log.
- **Redaction:** No new secrets or PII handling is introduced. The `encryptNodeConfig`/`decryptNodeConfig` and `stripEnvRefs` call paths are preserved unchanged.

## Verification

(continued below with failure-path check)

- `pnpm exec tsc --noEmit` exits 0 — verifies no type errors after refactoring
- `pnpm exec eslint src/` exits 0 — verifies no lint violations
- `grep -r 'TRPCError' src/server/services/pipeline-graph.ts` — service module uses TRPCError for error paths (failure visibility)

## Files Likely Touched

- `src/app/(dashboard)/alerts/page.tsx`
- `src/app/(dashboard)/alerts/_components/alert-rules-section.tsx`
- `src/app/(dashboard)/alerts/_components/notification-channels-section.tsx`
- `src/app/(dashboard)/alerts/_components/webhooks-section.tsx`
- `src/app/(dashboard)/alerts/_components/alert-history-section.tsx`
- `src/app/(dashboard)/alerts/_components/constants.ts`
- `src/server/routers/pipeline.ts`
- `src/server/services/pipeline-graph.ts`
- `src/server/routers/dashboard.ts`
- `src/server/services/dashboard-data.ts`
- `src/app/(dashboard)/settings/_components/team-settings.tsx`
- `src/app/(dashboard)/settings/_components/users-settings.tsx`
- `src/app/(dashboard)/settings/_components/team-member-dialogs.tsx`
- `src/app/(dashboard)/settings/_components/user-management-dialogs.tsx`
