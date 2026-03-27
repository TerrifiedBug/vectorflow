---
phase: 05-cross-environment-promotion-ui
plan: 02
subsystem: ui
tags: [react, trpc, promotion, pipeline, dialog, wizard, docs]

# Dependency graph
requires:
  - phase: 05-cross-environment-promotion-ui
    plan: 01
    provides: promotionRouter tRPC procedures (preflight, diffPreview, initiate, history)

provides:
  - Multi-step PromotePipelineDialog with 5-step wizard (target, preflight, diff, confirm, result)
  - PromotionHistory component on pipeline detail page
  - Public docs: Cross-Environment Promotion section in pipeline-editor.md

affects:
  - pipelines/page.tsx: PromotePipelineDialog consumer (unchanged interface, new behavior)
  - pipelines/[id]/page.tsx: PromotionHistory added to editor layout
  - docs/public/user-guide/pipeline-editor.md: new section added

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Multi-step dialog state machine with useState<Step> type
    - Conditional useQuery enabled flags per step (step === "preflight", step === "diff")
    - QueryClient.invalidateQueries on promotion success (pipeline.list + promotion.history)
    - PromotionHistory returns null when no records — no empty section clutter

key-files:
  created: []
  modified:
    - src/components/promote-pipeline-dialog.tsx
    - src/app/(dashboard)/pipelines/[id]/page.tsx
    - docs/public/user-guide/pipeline-editor.md

key-decisions:
  - "PromotionHistory rendered at bottom of pipeline editor layout (same pattern as metrics/logs panels) — avoids restructuring the full-screen editor"
  - "diffPreview only takes pipelineId (not targetEnvironmentId) — the preview shows SECRET[name] vs env-var substitution, not per-target diff; plan interface was simplified to match actual router"

# Metrics
duration: 8min
completed: 2026-03-27
---

# Phase 05 Plan 02: Cross-Environment Promotion UI Summary

**5-step promotion wizard (target -> preflight -> diff -> confirm -> result) with secret validation blocking, ConfigDiff substitution preview, and promotion history table on pipeline detail page**

## Performance

- **Duration:** ~8 min
- **Completed:** 2026-03-27T02:07:31Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Replaced the single-step PromotePipelineDialog with a 5-step multi-step wizard consuming `trpc.promotion.preflight`, `trpc.promotion.diffPreview`, and `trpc.promotion.initiate`
- Step 2 (Preflight): auto-fires preflight query on entry, shows missing secrets with red alert blocking "Next", name collision amber warning, green success when all present
- Step 3 (Diff): shows ConfigDiff with source YAML vs env-var-substituted target YAML, info note about SECRET[name] env var resolution
- Step 4 (Confirm): fires initiate mutation with spinner, returns to diff on error
- Step 5 (Result): Clock + amber box for pending approval, CheckCircle + green box for auto-deployed
- PromotionHistory component on pipeline detail page: table with Date, Source, Target, Promoted By, Status columns; status badges with correct variants; returns null when empty
- Public docs updated with full Cross-Environment Promotion section covering workflow steps, approval, secret pre-flight, and history

## Task Commits

Each task was committed atomically:

1. **Task 1: Multi-step PromotePipelineDialog** - `699b0a5` (feat)
2. **Task 2: PromotionHistory + docs** - `4ad3d09` (feat)

## Files Created/Modified

- `src/components/promote-pipeline-dialog.tsx` - Complete rewrite as 5-step wizard (293 insertions, 97 deletions)
- `src/app/(dashboard)/pipelines/[id]/page.tsx` - Added Badge import, statusVariant helper, PromotionHistory component, `<PromotionHistory pipelineId={pipelineId} />` render
- `docs/public/user-guide/pipeline-editor.md` - Added Cross-Environment Promotion section with 4 subsections

## Decisions Made

- PromotionHistory is rendered at the bottom of the pipeline editor layout as a `shrink-0 border-t` div — consistent with the existing metrics and logs panel pattern
- `diffPreview` procedure only takes `pipelineId` (not `targetEnvironmentId`) — the plan's interface spec was simplified; the actual router generates source YAML (with SECRET refs) vs target YAML (with env var substitution), which is the correct diff to show

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Merged main into worktree to get Plan 01 code**
- **Found during:** Task 1 setup
- **Issue:** Worktree `agent-a0ce0644` branched from `main` before Plan 01 (`796d52f`, `76a8570`) was committed. `promotion.ts` router was missing, so `trpc.promotion.*` calls would fail TypeScript compilation.
- **Fix:** `git merge main --no-edit` (fast-forward, no conflicts) — brought in all Plan 01 commits plus other recent merges
- **Files affected:** All Plan 01 files (promotion.ts, promotion-service.ts, schema.prisma, etc.)
- **Commit:** Pre-task merge (fast-forward)

**2. [Rule 1 - Deviation] diffPreview input shape differs from plan spec**
- **Found during:** Task 1 (reading actual promotion.ts router)
- **Issue:** Plan's interface spec shows `diffPreview: query({ pipelineId, targetEnvironmentId })` but the actual router only takes `{ pipelineId }`. The diff shows SECRET[name] refs vs `${VF_SECRET_NAME}` env var form — the substitution is format-based, not target-env-specific.
- **Fix:** Used actual router signature `{ pipelineId }` — no functional change needed, the diff preview is still meaningful and correct
- **Impact:** None — the plan's conceptual goal (show substitution diff) is achieved; the specific input shape matched the actual implementation

---

**Total deviations:** 2 auto-resolved (1 blocking merge, 1 interface mismatch caught before implementation)

## Known Stubs

None — all tRPC calls wire to real backend procedures from Plan 01.

## Self-Check: PASSED

- src/components/promote-pipeline-dialog.tsx: FOUND
- src/app/(dashboard)/pipelines/[id]/page.tsx: FOUND (PromotionHistory added)
- docs/public/user-guide/pipeline-editor.md: FOUND (Cross-Environment Promotion section added)
- Commit 699b0a5: FOUND
- Commit 4ad3d09: FOUND
- pnpm build: PASSED (no type errors)

---
*Phase: 05-cross-environment-promotion-ui*
*Completed: 2026-03-27*
