# Roadmap: VectorFlow

## Milestones

- ✅ **v1.0 Enterprise Scale** — Phases 1-7 (shipped 2026-03-27) — [archive](milestones/v1.0-ROADMAP.md)
- 🚧 **v1.1 UX Polish** — Phases 8-11 (in progress)

## Phases

<details>
<summary>✅ v1.0 Enterprise Scale (Phases 1-7) — SHIPPED 2026-03-27</summary>

- [x] Phase 1: Fleet Performance Foundation (2/2 plans) — completed 2026-03-26
- [x] Phase 2: Fleet Organization (4/4 plans) — completed 2026-03-26
- [x] Phase 3: Fleet Health Dashboard (2/2 plans) — completed 2026-03-27
- [x] Phase 4: Outbound Webhooks (3/3 plans) — completed 2026-03-27
- [x] Phase 5: Cross-Environment Promotion UI (3/3 plans) — completed 2026-03-27
- [x] Phase 6: OpenAPI Specification (2/2 plans) — completed 2026-03-27
- [x] Phase 7: Cross-Environment Promotion GitOps (2/2 plans) — completed 2026-03-27

</details>

### 🚧 v1.1 UX Polish (In Progress)

**Milestone Goal:** Improve navigation, filtering, and alert organization so operators can find what matters faster.

- [ ] **Phase 8: Pipeline Folders in Sidebar** - Move group tree from content area to a sliding sidebar panel for persistent navigation
- [ ] **Phase 9: Alerts Page Categorization** - Separate actionable alerts from informational with filter tabs and badge counts
- [x] **Phase 10: Deployment Matrix Filters** - Add search, status, and tag filtering to the fleet deployment matrix (completed 2026-03-27)
- [ ] **Phase 11: Compliance Tags Rename** - Rename "Data Classification Tags" to "Compliance Tags" across all UI surfaces

## Phase Details

### Phase 8: Pipeline Folders in Sidebar
**Goal**: Users can browse and filter pipelines via a persistent sidebar folder tree, freeing the content area for a full-width pipeline table
**Depends on**: Nothing (first phase of v1.1)
**Requirements**: NAV-01, NAV-02, NAV-03, NAV-04
**Success Criteria** (what must be TRUE):
  1. When a user navigates to /pipelines, a sidebar panel slides in showing "All Pipelines" and the folder tree with expand/collapse, matching the Settings/Library sliding pattern
  2. Clicking a folder in the sidebar filters the pipeline list to show only that group's pipelines
  3. Clicking "Manage" in the sidebar Pipelines panel opens the manage groups dialog
  4. The pipeline table uses full content width with no inline groups panel
**Plans:** 1/2 plans executed
Plans:
- [x] 08-01-PLAN.md — Store, tree adaptation, and ManageGroupsDialog bug fix
- [x] 08-02-PLAN.md — Sidebar panel wiring, page cleanup, and visual verification
**UI hint**: yes

### Phase 9: Alerts Page Categorization
**Goal**: Operators can quickly triage alerts by separating actionable infrastructure problems from informational system events
**Depends on**: Phase 8
**Requirements**: ALERT-01, ALERT-02, ALERT-03, ALERT-04, ALERT-05
**Success Criteria** (what must be TRUE):
  1. Alert history section displays filter tabs (All / Actionable / Informational) above the event table
  2. Selecting Actionable tab shows only infrastructure/threshold alerts (crashes, unreachable, CPU, memory, disk, error rate, fleet errors)
  3. Selecting Informational tab shows only event-based alerts (deployed, joined, left, promotion, backup, certificate, SCIM)
  4. Each tab displays a badge count of firing/unresolved alerts in that category
  5. The Actionable tab is selected by default when landing on the alerts page
**Plans:** 2 plans
Plans:
- [x] 09-01-PLAN.md — TDD: getAlertCategory utility with unit tests
- [x] 09-02-PLAN.md — Category tabs, filtering, and badge counts in AlertHistorySection
**UI hint**: yes

### Phase 10: Deployment Matrix Filters
**Goal**: Operators can quickly locate specific pipelines within a large deployment matrix using search, status, and tag filters
**Depends on**: Phase 9
**Requirements**: MATRIX-01, MATRIX-02, MATRIX-03, MATRIX-04
**Success Criteria** (what must be TRUE):
  1. Deployment matrix has a toolbar with a search input that filters rows by pipeline name (client-side, instant)
  2. Deployment matrix toolbar has a status filter dropdown (Running, Stopped, Crashed) that filters matrix rows
  3. Deployment matrix toolbar has a tag filter for compliance tags that filters matrix rows
  4. Filter state (search, status, tags) persists in URL query params so filtered views are shareable and survive page refresh
**Plans:** 2/2 plans complete
Plans:
- [x] 10-01-PLAN.md — Backend tags extension, useMatrixFilters hook, and DeploymentMatrixToolbar component
- [x] 10-02-PLAN.md — Fleet page wiring, matrix modifications, and visual verification
**UI hint**: yes

### Phase 11: Compliance Tags Rename
**Goal**: Eliminate naming confusion between "Data Classification Tags" and node "Labels" by adopting the clearer "Compliance Tags" name
**Depends on**: Phase 10
**Requirements**: NAME-01
**Success Criteria** (what must be TRUE):
  1. Team settings page shows "Compliance Tags" instead of "Data Classification Tags"
  2. Pipeline toolbar, bulk action bar, and all related UI text use "Compliance Tags" consistently
**Plans:** 1 plan
Plans:
- [ ] 11-01-PLAN.md — Rename "Classification Tags" to "Compliance Tags" in source code and docs
**UI hint**: yes

## Progress

**Execution Order:** Phase 8 -> 9 -> 10 -> 11

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 8. Pipeline Folders in Sidebar | v1.1 | 1/2 | In Progress|  |
| 9. Alerts Page Categorization | v1.1 | 0/2 | Planned | - |
| 10. Deployment Matrix Filters | v1.1 | 2/2 | Complete    | 2026-03-27 |
| 11. Compliance Tags Rename | v1.1 | 0/1 | Planned | - |
