---
phase: 03-fleet-health-dashboard
plan: "01"
subsystem: fleet-backend
tags: [tRPC, fleet, node-groups, health-stats, drill-down]
dependency_graph:
  requires: []
  provides: [groupHealthStats-procedure, nodesInGroup-procedure, nodeMatchesGroup-util]
  affects: [fleet-health-dashboard-UI, enrollment-route]
tech_stack:
  added: []
  patterns: [3-parallel-DB-queries, application-layer-aggregation, shared-utility-extraction]
key_files:
  created:
    - src/lib/node-group-utils.ts
    - src/lib/__tests__/node-group-utils.test.ts
  modified:
    - src/server/routers/node-group.ts
    - src/server/routers/__tests__/node-group.test.ts
    - src/app/api/agent/enroll/route.ts
decisions:
  - "nodeMatchesGroup extracted to shared util — enrollment route and router import from single source of truth"
  - "groupHealthStats uses 3 parallel Promise.all queries (nodes, groups, firingAlerts) — single round trip with application-layer aggregation"
  - "Ungrouped synthetic entry uses id __ungrouped__ and complianceRate 100 (vacuous truth, no requiredLabels)"
  - "nodesInGroup sorts UNREACHABLE(0) < DEGRADED(1) < UNKNOWN(2) < HEALTHY(3) then by name — worst-first for operator attention"
  - "cpuLoad uses nodeMetrics[0].loadAvg1 (latest metric, desc order) — null when no metrics rather than 0 to distinguish no-data"
metrics:
  duration_minutes: 4
  completed_date: "2026-03-27"
  tasks_completed: 1
  files_changed: 5
---

# Phase 03 Plan 01: Fleet Health Dashboard Backend Summary

**One-liner:** tRPC groupHealthStats (per-group aggregation) and nodesInGroup (sorted drill-down) with shared nodeMatchesGroup utility extracted from enrollment route.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Extract nodeMatchesGroup + add groupHealthStats and nodesInGroup procedures | afe0b60 | src/lib/node-group-utils.ts, src/server/routers/node-group.ts, src/app/api/agent/enroll/route.ts, src/server/routers/__tests__/node-group.test.ts, src/lib/__tests__/node-group-utils.test.ts |

## What Was Built

### `src/lib/node-group-utils.ts`
Shared `nodeMatchesGroup(nodeLabels, criteria)` utility:
- Empty criteria `{}` is a catch-all returning `true` for any node
- Otherwise every criteria key-value must match the node's labels (subset match)
- Now imported by both the enrollment route and the nodeGroup router

### `groupHealthStats` procedure
- Input: `{ environmentId: string }`
- Auth: VIEWER via `withTeamAccess`
- 3 parallel queries via `Promise.all`: all nodes in env, all groups in env, all firing alerts in env
- Per-group computation: `totalNodes`, `onlineCount` (HEALTHY only), `alertCount` (firing only), `complianceRate` (% nodes with all requiredLabel keys, vacuously 100 when requiredLabels=[])
- Synthetic `{ id: "__ungrouped__", name: "Ungrouped", ... }` appended when nodes exist outside all group criteria

### `nodesInGroup` procedure
- Input: `{ groupId: string, environmentId: string }` (environmentId for withTeamAccess resolution)
- Auth: VIEWER via `withTeamAccess`
- Handles `groupId === "__ungrouped__"` by fetching all groups and filtering nodes not matching any
- Throws `NOT_FOUND` for missing groupId
- Each node in result has: `id`, `name`, `status`, `labels`, `lastSeen`, `cpuLoad` (from `nodeMetrics[0].loadAvg1 ?? null`), `labelCompliant` (bool)
- Sorted: UNREACHABLE first, then DEGRADED, UNKNOWN, HEALTHY — then alphabetically by name

## Tests

27 tests passing across 2 test files:
- `src/server/routers/__tests__/node-group.test.ts` — 12 existing (list/create/update/delete) + 12 new (groupHealthStats + nodesInGroup)
- `src/lib/__tests__/node-group-utils.test.ts` — 3 pure unit tests for nodeMatchesGroup

## Deviations from Plan

**1. [Rule 3 - Blocking] Worktree missing Phase 02 baseline**

- **Found during:** Task 1 start
- **Issue:** The worktree branch `worktree-agent-a3f6dc87` was branched from an older commit (b2a6bf5) before Phase 02 work landed in main. The `node-group.ts` router and related Phase 02 files did not exist in the worktree.
- **Fix:** Cherry-picked Phase 02 commits from main into the worktree and committed them as a baseline before implementing Plan 03-01.
- **Files modified:** 24 files from Phase 02 (schema, migrations, router, components, tests)
- **Commit:** 3624f44

## Known Stubs

None — all procedures return real data from DB queries with full field mapping.

## Self-Check: PASSED

- `src/lib/node-group-utils.ts` — EXISTS
- `src/lib/__tests__/node-group-utils.test.ts` — EXISTS
- `src/server/routers/node-group.ts` — EXISTS with groupHealthStats and nodesInGroup
- `src/server/routers/__tests__/node-group.test.ts` — EXISTS with new test blocks
- Commit `afe0b60` — EXISTS (verified via git log)
- All 27 tests PASSED
