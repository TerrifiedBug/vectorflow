---
estimated_steps: 4
estimated_files: 2
skills_used:
  - lint
  - review
---

# T02: Extract pipeline router business logic to service module

**Slice:** S02 — Router & Component Refactoring
**Milestone:** M001

## Description

The pipeline router (`src/server/routers/pipeline.ts`, 1318 lines) contains 25 tRPC procedures. It already delegates to services like `pipeline-version.ts` and `copy-pipeline-graph.ts`, but 3 handlers have substantial inline logic: `saveGraph` (L683-825, 142 lines — component validation + node/edge transaction), `promote` (L559-682, 123 lines — cross-environment pipeline copy with secret stripping), and `discardChanges` (L826-911, 85 lines — version restore). Extracting these to `src/server/services/pipeline-graph.ts` brings the router under ~800 lines and makes the business logic independently testable.

**Key constraints from research:**
- Follow the existing service pattern: pure function exports, import `prisma` from `@/lib/prisma`, throw `TRPCError` for errors
- `saveGraph` sets `ctx.auditMetadata` directly — this side-effect MUST remain in the router. The service function returns the data, the router sets the metadata.
- Service functions accept `userId: string` instead of the full `ctx` object
- For `saveGraph` and `discardChanges` which use `prisma.$transaction(async (tx) => { ... })`, follow the `copy-pipeline-graph.ts` pattern: define `type Tx = Prisma.TransactionClient` and accept `tx` as a parameter
- Keep all `.use(withAudit())`, `.use(withTeamAccess())`, `.use(requireSuperAdmin())` middleware in the router
- Keep Zod schemas (L25-52) in the router file — they're local to the router

## Steps

1. **Read the pipeline router** to understand the full handler bodies for `saveGraph` (L683-825), `promote` (L559-682), and `discardChanges` (L826-911). Identify all dependencies: prisma calls, imported services, types, and `ctx` accesses.

2. **Create `src/server/services/pipeline-graph.ts`** with 3 exported functions:
   - `saveGraphComponents(tx: Tx, pipelineId: string, nodes: ..., edges: ..., userId: string)` — the validation + transaction body from `saveGraph`. Returns the saved pipeline data. Does NOT set `auditMetadata`.
   - `promotePipeline(sourcePipelineId: string, targetEnvironmentId: string, userId: string, ...)` — the cross-environment copy logic from `promote`. Returns the promoted pipeline.
   - `discardPipelineChanges(tx: Tx, pipelineId: string, versionId: string)` — the version restore logic from `discardChanges`. Returns the restored pipeline.
   - Use `type Tx = Prisma.TransactionClient` at the top, matching `copy-pipeline-graph.ts`.

3. **Update the pipeline router** to import and call the service functions. Each handler becomes a thin wrapper: parse input, call service function, set `auditMetadata` if needed, return result. The `$transaction` boundary can stay in either the router or the service depending on what reads more naturally — but `auditMetadata` assignment MUST stay in the router.

4. **Verify** `tsc --noEmit` and `eslint src/` both pass. Check `wc -l` on the router to confirm under ~800 lines.

## Must-Haves

- [ ] `pipeline-graph.ts` service module exists with exported functions for saveGraph, promote, and discardChanges logic
- [ ] Pipeline router under ~800 lines
- [ ] `ctx.auditMetadata` assignment remains in the router, NOT in the service
- [ ] Service functions accept `userId` parameter, not full `ctx`
- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm exec eslint src/` exits 0
- [ ] No API contract changes — router endpoints accept same inputs and return same outputs

## Verification

- `pnpm exec tsc --noEmit` exits 0
- `pnpm exec eslint src/` exits 0
- `wc -l src/server/routers/pipeline.ts` — under 850 lines
- `test -f src/server/services/pipeline-graph.ts`
- `grep -q 'auditMetadata' src/server/routers/pipeline.ts` — still in router
- `! grep -q 'auditMetadata' src/server/services/pipeline-graph.ts` — NOT in service

## Inputs

- `src/server/routers/pipeline.ts` — the 1318-line router to refactor
- `src/server/services/copy-pipeline-graph.ts` — reference for the `Tx` type pattern
- `src/server/services/pipeline-version.ts` — reference for the service module pattern

## Expected Output

- `src/server/services/pipeline-graph.ts` — new service module with 3 exported functions (~300 lines)
- `src/server/routers/pipeline.ts` — slimmed router with handlers delegating to service (~800 lines)
