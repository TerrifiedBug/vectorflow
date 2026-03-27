---
phase: 07-cross-environment-promotion-gitops
plan: 03
subsystem: frontend
tags: [gitops, promotion, github, environment-settings, ui, webhook]

# Dependency graph
requires:
  - phase: 07-cross-environment-promotion-gitops
    plan: 01
    provides: gitops-promotion service, PR merge webhook handler, AWAITING_PR_MERGE status

provides:
  - "promotion" gitOpsMode value in environment.update tRPC procedure
  - GitSyncSection UI with "Promotion (PR-based)" dropdown option
  - Inline setup wizard showing step-by-step GitHub webhook configuration guide
  - Webhook URL and one-time secret display with copy buttons for promotion mode

affects:
  - Environment settings page — users can now select GitOps Promotion mode
  - environment.update router — now accepts "promotion" as valid gitOpsMode

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inline setup wizard pattern: numbered steps rendered as flex list items inside a muted rounded card"
    - "GitOps mode webhook secret lifecycle: auto-generate on first enable, clear on disable (shared pattern for bidirectional and promotion)"

key-files:
  created: []
  modified:
    - src/server/routers/environment.ts
    - src/components/environment/git-sync-section.tsx

key-decisions:
  - "Promotion mode reuses same gitWebhookSecret field and auto-generation logic as bidirectional mode — single webhook endpoint /api/webhooks/git serves both"
  - "Setup wizard is inline (not a modal or separate page) — consistent with existing bidirectional webhook instructions pattern"
  - "needsWebhookSecret variable extracted to avoid duplication in bidirectional/promotion branch logic"

requirements-completed:
  - GIT-01
  - GIT-05

# Metrics
duration: 3min
completed: 2026-03-27
---

# Phase 07 Plan 03: GitOps Setup Wizard UI Summary

**GitOps Promotion mode added to environment settings: "promotion" gitOpsMode value with inline GitHub webhook setup guide showing step-by-step configuration, webhook URL, and one-time secret.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-27T03:25:48Z
- **Completed:** 2026-03-27T03:28:16Z
- **Tasks:** 3 (2 implementation + 1 auto-approved checkpoint)
- **Files modified:** 2

## Accomplishments

- Extended `environment.update` tRPC procedure to accept `"promotion"` as a valid `gitOpsMode` value — previously limited to "off" | "push" | "bidirectional"
- Auto-generates an encrypted webhook secret when switching to "promotion" mode (same lifecycle logic as bidirectional: generate on first enable, clear on mode change)
- Added "Promotion (PR-based)" option to the GitOps Mode dropdown in `GitSyncSection`
- When "promotion" is selected, an inline setup guide appears with:
  - Numbered steps explaining the full GitHub webhook configuration process
  - Webhook URL field with copy button
  - One-time webhook secret display with copy button (shown only after save)
  - Instructions to select "Pull requests" event type (not "push" events)

## Task Commits

1. **Task 1: Add "promotion" gitOpsMode to environment router** - `f817f72` (feat)
2. **Task 2: Update GitSyncSection with promotion mode and setup guide** - `93c5ebf` (feat)
3. **Task 3: Verification checkpoint** - Auto-approved (autonomous mode)

## Files Created/Modified

- `src/server/routers/environment.ts` — `gitOpsMode` enum extended to include "promotion"; `needsWebhookSecret` condition covers both bidirectional and promotion
- `src/components/environment/git-sync-section.tsx` — "Promotion" SelectItem added; inline setup guide with 4 numbered steps, webhook URL copy, and secret copy

## Decisions Made

- Promotion mode reuses the same `gitWebhookSecret` field and auto-generation logic as bidirectional mode — the single `/api/webhooks/git` endpoint already handles both modes
- Setup wizard is rendered inline inside the existing Git Integration card — consistent with the bidirectional webhook info pattern already established
- `needsWebhookSecret` extracted as a boolean variable to avoid duplicating the `bidirectional || promotion` condition in both the generate and clear branches

## Deviations from Plan

None — plan executed exactly as written.

## Checkpoint: Auto-Approved

Task 3 was a `checkpoint:human-verify` for the GitOps setup wizard UI. Auto-approved in autonomous mode.

**What was built:** Environment settings now show "Promotion (PR-based)" in the GitOps Mode dropdown. Selecting it reveals the inline setup guide with webhook configuration instructions.

---

## Self-Check: PASSED

- `src/server/routers/environment.ts` — exists and contains `"promotion"` in gitOpsMode enum
- `src/components/environment/git-sync-section.tsx` — exists and contains promotion mode setup guide
- Commit `f817f72` — verified in git log
- Commit `93c5ebf` — verified in git log

*Phase: 07-cross-environment-promotion-gitops*
*Completed: 2026-03-27*
