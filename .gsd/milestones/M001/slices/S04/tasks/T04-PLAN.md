---
estimated_steps: 4
estimated_files: 3
skills_used:
  - test
  - lint
---

# T04: Write pipeline-graph and deploy-agent tests with Prisma mocking

**Slice:** S04 — Foundational Test Suite
**Milestone:** M001

## Description

Write the final two test files covering the pipeline CRUD and deploy domains (R002). These are the most complex mocking targets: `pipeline-graph.ts` has nested service dependencies (calls `generateVectorYaml`), transaction-scoped `Tx` parameters, and 15 TRPCError throw sites. `deploy-agent.ts` depends on multiple service modules (`validateConfig`, `createVersion`, `gitSyncCommitPipeline`, `pushRegistry`).

After this task, all 7 test files exist and pass, covering all four R002 domains. The final step verifies `tsc --noEmit` and `eslint src/` still pass (R001, R008).

## Steps

1. Create `src/server/services/__tests__/pipeline-graph.test.ts`:
   - Mock `@/lib/prisma` using the pattern from T03
   - Mock `@/lib/config-generator` to control `generateVectorYaml` output (used by `detectConfigChanges`):
     ```typescript
     vi.mock('@/lib/config-generator', () => ({
       generateVectorYaml: vi.fn(),
     }));
     ```
   - Test `detectConfigChanges`:
     - No changes: mock `generateVectorYaml` to return same YAML as stored version → returns `{ hasChanges: false }`
     - Has changes: mock different YAML → returns `{ hasChanges: true }` with diff
   - Test `saveGraphComponents` error paths:
     - Pipeline not found: mock `prisma.pipeline.findUnique` returning null → throws TRPCError with `NOT_FOUND`
     - Duplicate component keys: construct input with duplicate keys → throws TRPCError
   - Test `listPipelinesForEnvironment`:
     - Mock `prisma.pipeline.findMany` with fixture data → verify correct shape returned
     - Empty environment → returns empty array
   - For functions accepting `Tx` parameter: pass `prismaMock` as the transaction client (it satisfies the `Tx` type since it's a deep mock of PrismaClient)

2. Create `src/server/services/__tests__/deploy-agent.test.ts`:
   - Mock `@/lib/prisma`
   - Mock service dependencies:
     ```typescript
     vi.mock('@/server/services/validator', () => ({ validateConfig: vi.fn() }));
     vi.mock('@/server/services/pipeline-version', () => ({ createVersion: vi.fn() }));
     vi.mock('@/server/services/git-sync', () => ({ gitSyncCommitPipeline: vi.fn() }));
     vi.mock('@/server/services/push-registry', () => ({ pushRegistry: vi.fn() }));
     vi.mock('@/lib/config-generator', () => ({ generateVectorYaml: vi.fn() }));
     vi.mock('@/server/services/config-crypto', () => ({ decryptNodeConfig: vi.fn() }));
     vi.mock('@/server/services/system-vector', () => ({ startSystemVector: vi.fn(), stopSystemVector: vi.fn() }));
     ```
   - Test `deployAgent` error paths:
     - Pipeline not found: mock `prisma.pipeline.findUnique` returning null → returns `{ success: false, error: ... }`
     - Validation failure: mock `validateConfig` returning errors → returns `{ success: false, validationErrors: [...] }`
   - Test `deployAgent` success path:
     - Mock all dependencies to succeed → returns `{ success: true, versionId, versionNumber }`

3. If eslint fails on test files (e.g., `vi.mock` patterns triggering lint rules), add an override in `eslint.config.mjs` to exclude `**/__tests__/**` or `**/*.test.ts` from problematic rules. Only do this if necessary — check `pnpm exec eslint src/` first.

4. Run final verification:
   - `pnpm exec vitest run --reporter=verbose` — all 7 test files pass
   - `pnpm exec tsc --noEmit` — exits 0 (R001)
   - `pnpm exec eslint src/` — exits 0 (R008)

## Must-Haves

- [ ] Pipeline-graph tests cover `detectConfigChanges`, `saveGraphComponents` error paths, and `listPipelinesForEnvironment`
- [ ] Deploy-agent tests cover `deployAgent` error paths and success path
- [ ] All 7 test files pass with `pnpm test`
- [ ] `tsc --noEmit` exits 0 (R001 preserved)
- [ ] `eslint src/` exits 0 (R008 preserved)

## Verification

- `pnpm exec vitest run --reporter=verbose` exits 0 with 7 test files passing
- `pnpm exec tsc --noEmit` exits 0
- `pnpm exec eslint src/` exits 0
- `test -f src/server/services/__tests__/pipeline-graph.test.ts`
- `test -f src/server/services/__tests__/deploy-agent.test.ts`

## Inputs

- `src/server/services/pipeline-graph.ts` — exports `saveGraphComponents(tx, params)`, `promotePipeline(params)`, `discardPipelineChanges(pipelineId)`, `detectConfigChanges(params)`, `listPipelinesForEnvironment(environmentId)`; imports `prisma` from `@/lib/prisma`, `generateVectorYaml` from `@/lib/config-generator`; uses `Tx` type for transaction parameter; throws `TRPCError` at 15 sites
- `src/server/services/deploy-agent.ts` — exports `deployAgent(pipelineId, userId, changelog?, prebuiltYaml?)`, `undeployAgent(pipelineId, userId)`; imports `prisma`, `generateVectorYaml`, `validateConfig`, `createVersion`, `decryptNodeConfig`, `startSystemVector`, `stopSystemVector`, `gitSyncCommitPipeline`, `pushRegistry`; returns `AgentDeployResult` interface
- `src/__mocks__/lib/prisma.ts` — created in T01; provides `prismaMock`
- `vitest.config.ts` — created in T01
- `eslint.config.mjs` — current eslint config; may need test file overrides
- `src/server/services/__tests__/alert-evaluator.test.ts` — created in T03; reference for Prisma mocking pattern

## Expected Output

- `src/server/services/__tests__/pipeline-graph.test.ts` — new test file for pipeline CRUD domain
- `src/server/services/__tests__/deploy-agent.test.ts` — new test file for deploy domain
- `eslint.config.mjs` — possibly modified if test files need lint overrides
