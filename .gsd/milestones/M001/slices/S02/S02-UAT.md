# S02: Router & Component Refactoring — UAT Script

## Preconditions

- Fresh `pnpm install` completed
- PostgreSQL running with seeded dev data (at least 1 environment, 1 pipeline, alert rules, notification channels, webhooks, team members, users)
- Dev server running (`pnpm dev`)

---

## Test 1: Type Safety Preserved

**Goal:** Confirm all refactored files compile cleanly.

1. Run `pnpm exec tsc --noEmit`
2. **Expected:** Exit code 0, no errors

3. Run `pnpm exec eslint src/`
4. **Expected:** Exit code 0, no warnings or errors

---

## Test 2: File Size Targets Met

**Goal:** Confirm no non-exempt source file exceeds ~800 lines.

1. Run `find src -name '*.ts' -o -name '*.tsx' | xargs wc -l | sort -rn | head -20`
2. **Expected:** Only exempt files appear above 800 lines:
   - `src/generated/prisma/index.d.ts` — generated, exempt
   - `src/generated/prisma/runtime/client.d.ts` — generated, exempt
   - `src/lib/vrl/function-registry.ts` — exempt per D003 (declarative data)
   - `src/stores/flow-store.ts` — exempt per D002 (moderate refactoring scope)
3. **Expected specific file counts:**
   - `alerts/page.tsx` ≤ 200 lines
   - `pipeline.ts` ≤ 850 lines
   - `dashboard.ts` ≤ 850 lines
   - `team-settings.tsx` ≤ 800 lines
   - `users-settings.tsx` ≤ 800 lines

---

## Test 3: Alerts Page Renders All Sections

**Goal:** Confirm the 4 extracted alert section components render correctly.

1. Navigate to the Alerts page in the browser
2. **Expected:** Page loads without errors
3. **Expected:** Alert Rules section is visible with rule list/create button
4. **Expected:** Notification Channels section is visible below rules
5. **Expected:** Webhooks section is visible below channels
6. **Expected:** Alert History section is visible at the bottom with event log

### Edge cases:
- Click "Create Rule" — dialog should open with metric/condition form fields
- Click "Test" on a notification channel — should trigger test send
- Expand a webhook row — should show webhook details
- Page through alert history — pagination should work

---

## Test 4: Pipeline CRUD Still Works

**Goal:** Confirm extracted pipeline-graph.ts service doesn't break pipeline operations.

1. Navigate to Pipelines list page
2. **Expected:** Pipeline list loads with correct status badges (running/stopped/error)
3. **Expected:** Each pipeline shows "Undeployed changes" badge if it has changes vs. deployed version

4. Open an existing pipeline in the editor
5. Add or move a node, then click Save
6. **Expected:** Save completes without error, toast notification appears

7. Click "Discard Changes" (if available — pipeline must have a deployed version + unsaved changes)
8. **Expected:** Graph reverts to the last deployed version

9. If a staging environment exists, open a production pipeline and click Promote
10. **Expected:** Pipeline is copied to staging with secrets stripped

### Edge cases:
- Save with invalid graph (e.g., disconnected node) — should show validation error, not 500
- Discard on a pipeline that was never deployed — should show appropriate error message

---

## Test 5: Dashboard Loads Correctly

**Goal:** Confirm extracted dashboard-data.ts service produces correct dashboard data.

1. Navigate to the Dashboard page
2. **Expected:** Chart metrics load with time-series data (line charts)
3. **Expected:** Node cards display with status, metrics, hostname info
4. **Expected:** Pipeline cards display with pipeline name, status, environment

### Edge cases:
- Dashboard with no deployed pipelines — should show empty state, not error
- Dashboard time range selector — changing range should reload chart data

---

## Test 6: Settings Pages Function Correctly

**Goal:** Confirm extracted dialog components in settings pages work.

### Team Settings:
1. Navigate to Settings → Team
2. Click on a team member's actions menu
3. **Expected:** Reset Password dialog opens, shows password after confirm
4. **Expected:** Lock/Unlock dialog toggles member's locked status
5. **Expected:** Remove Member dialog removes member from team after confirm
6. If OIDC is configured: Link to OIDC dialog should appear and function

### User Management (super admin):
1. Navigate to Settings → Users (requires super admin)
2. Click "Create User"
3. **Expected:** Create User dialog opens with email, name, team, role fields
4. Fill in fields and submit
5. **Expected:** New user appears in the user list

6. Click a user's actions menu
7. **Expected:** Assign to Team dialog works with team selector
8. **Expected:** Lock/Unlock, Reset Password, Delete User dialogs function correctly

### Edge cases:
- Create user with duplicate email — should show validation error
- Delete the last super admin — should show appropriate warning/error

---

## Test 7: Service Module API Contracts

**Goal:** Confirm service modules export the expected functions and follow the established pattern.

1. Run `grep 'export.*function\|export.*const\|export.*async' src/server/services/pipeline-graph.ts`
2. **Expected:** 5 exported functions: `saveGraphComponents`, `promotePipeline`, `discardPipelineChanges`, `detectConfigChanges`, `listPipelinesForEnvironment`

3. Run `grep 'export.*function\|export.*const\|export.*async' src/server/services/dashboard-data.ts`
4. **Expected:** 3 exported functions: `computeChartMetrics`, `assembleNodeCards`, `assemblePipelineCards`

5. Run `grep -c 'TRPCError' src/server/services/pipeline-graph.ts`
6. **Expected:** ≥15 (error paths use TRPCError for failure visibility)

7. Run `grep 'auditMetadata' src/server/services/pipeline-graph.ts`
8. **Expected:** No matches (audit metadata assignment stays in router)

---

## Test 8: No Audit Trail Regression

**Goal:** Confirm audit logging still fires for pipeline mutations.

1. Perform a pipeline save operation
2. Check the audit log (Settings → Audit Log or DB query)
3. **Expected:** Save operation is logged with correct procedure name and metadata
4. Perform a promote operation
5. **Expected:** Promote operation is logged in audit trail

---

## Pass Criteria

All 8 tests pass. Tests 1-2 are automated (CI-verifiable). Tests 3-6 require browser verification. Tests 7-8 are semi-automated (CLI + browser).
