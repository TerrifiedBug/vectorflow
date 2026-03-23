---
id: T02
parent: S02
milestone: M001
provides:
  - pipeline-graph.ts service module with saveGraphComponents, promotePipeline, discardPipelineChanges, detectConfigChanges, listPipelinesForEnvironment
  - pipeline router slimmed from 1318 to 847 lines
key_files:
  - src/server/services/pipeline-graph.ts
  - src/server/routers/pipeline.ts
key_decisions:
  - Extracted listPipelinesForEnvironment and detectConfigChanges in addition to the 3 planned handlers to meet the <850 line target; the duplicated YAML-diff logic in list+get was the natural candidate
  - Service functions accept plain parameters (userId, pipelineId) not full tRPC ctx; audit metadata assignment stays in router
  - discardPipelineChanges owns its own prisma.$transaction since it doesn't need external tx coordination; saveGraphComponents accepts tx parameter since the router wraps it
patterns_established:
  - Service extraction pattern: pure function exports, import prisma from @/lib/prisma, throw TRPCError for errors, accept Tx parameter for transaction-scoped work
  - detectConfigChanges shared utility avoids YAML-diff duplication between list and get handlers
observability_surfaces:
  - none — pure structural refactor, all existing TRPCError throws, audit middleware, and console.error calls preserved in their original call paths
duration: 15m
verification_result: passed
completed_at: 2026-03-23T09:32:00Z
blocker_discovered: false
---

# T02: Extract pipeline router business logic to service module

**Extracted saveGraph, promote, discardChanges, list logic, and YAML-diff utility from 1318-line pipeline router to pipeline-graph.ts service; router is now 847 lines**

## What Happened

Created `src/server/services/pipeline-graph.ts` (621 lines) with 5 exported functions:

1. **`saveGraphComponents(tx, params)`** — shared component validation + node/edge persistence inside an existing transaction. Returns decrypted pipeline. The router keeps the `ctx.auditMetadata` assignment.

2. **`promotePipeline(params)`** — cross-environment pipeline copy with secret stripping. Owns its own `prisma.$transaction` since it coordinates the name-collision check + create + copyPipelineGraph.

3. **`discardPipelineChanges(pipelineId)`** — validates preconditions (deployed, has snapshot) and restores the pipeline graph from the latest version snapshot.

4. **`detectConfigChanges(params)`** — pure function that generates YAML from nodes/edges and compares against a deployed version snapshot to detect undeployed changes. Replaces ~45 lines of duplicated logic that appeared in both `list` and `get` handlers.

5. **`listPipelinesForEnvironment(environmentId)`** — the full pipeline list query + mapping logic extracted from the `list` handler, including the `hasUndeployedChanges` and `hasStaleComponents` computations.

The pipeline router went from 1318 → 847 lines. Each extracted handler is now a thin wrapper: parse input, call service, set audit metadata if needed, return result.

Removed unused imports from the router: `encryptNodeConfig`, `Prisma`, `generateVectorYaml`, `stripEnvRefs`, `StrippedRef`. Kept `copyPipelineGraph` import (still used by `clone` handler) and `decryptNodeConfig` (still used by `get` handler).

## Verification

All 6 task-level verification checks pass:
- `pnpm exec tsc --noEmit` exits 0
- `pnpm exec eslint src/` exits 0
- Router is 847 lines (under 850)
- `pipeline-graph.ts` service file exists
- `auditMetadata` appears in router code
- `auditMetadata` does NOT appear in service code

Slice-level checks relevant to T02:
- `wc -l src/server/routers/pipeline.ts` → 847 (under 850) ✅
- `test -f src/server/services/pipeline-graph.ts` → exists ✅
- `grep -r 'TRPCError' src/server/services/pipeline-graph.ts` → 15 occurrences (failure visibility) ✅

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | 4.9s |
| 2 | `pnpm exec eslint src/` | 0 | ✅ pass | 22.3s |
| 3 | `wc -l src/server/routers/pipeline.ts` | 0 (847 lines) | ✅ pass | <1s |
| 4 | `test -f src/server/services/pipeline-graph.ts` | 0 | ✅ pass | <1s |
| 5 | `grep -q 'auditMetadata' src/server/routers/pipeline.ts` | 0 | ✅ pass | <1s |
| 6 | `! grep -q 'auditMetadata' src/server/services/pipeline-graph.ts` | 0 | ✅ pass | <1s |

## Diagnostics

No runtime observability changes — this is a pure structural refactor. All TRPCError throws, audit middleware chains, and console.error calls are preserved in their original call paths. The service module uses `TRPCError` directly for error paths (15 throw sites), matching the existing `pipeline-version.ts` pattern.

## Deviations

- Extracted `listPipelinesForEnvironment` and `detectConfigChanges` in addition to the 3 planned handlers. The plan estimated the router would reach ~800 lines after extracting the 3 handlers, but the actual reduction was only 1318→1024 (294 lines removed). The duplicated YAML-diff logic in `list` and `get` handlers was a natural extraction target that both eliminated code duplication and brought the router under the 850-line verification bar.
- Fixed `Prisma.InputJsonValue` type cast in service for `encryptNodeConfig` return — the original router code used `as unknown as typeof node.config` which resolved to `Record<string, unknown>`, not a Prisma-compatible type.

## Known Issues

None.

## Files Created/Modified

- `src/server/services/pipeline-graph.ts` — new service module with 5 exported functions (621 lines)
- `src/server/routers/pipeline.ts` — slimmed router delegating to service (847 lines, down from 1318)
