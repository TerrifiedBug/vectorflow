# Roadmap: M016 — Enterprise Scale

## Overview

M016 makes VectorFlow production-ready for corporate platform teams managing hundreds of pipelines across multi-environment fleets of 100+ nodes. The milestone builds in seven phases ordered by dependency: scale the platform first (fleet performance), then organize it (groups, labels, folders), make it observable (fleet health dashboard), wire up the integration surface (outbound webhooks), enable cross-environment promotion via UI, generate the OpenAPI spec, and finally add GitOps-driven promotion. Each phase is independently verifiable and unblocks the next.

## Milestones

- 🚧 **M016: Enterprise Scale** - Phases 1-7 (in progress)

## Phases

- [x] **Phase 1: Fleet Performance Foundation** - Eliminate scale ceilings in the heartbeat/SSE/alert evaluation path so 100+ node fleets are stable (completed 2026-03-26)
- [ ] **Phase 2: Fleet Organization** - Node groups with label enforcement, nested pipeline folders, and bulk tag operations
- [x] **Phase 3: Fleet Health Dashboard** - Aggregated group-level and per-node health view redesigned for 100+ nodes (completed 2026-03-27)
- [ ] **Phase 4: Outbound Webhooks** - HMAC-signed event subscriptions with retry, dead-letter separation, and delivery history UI
- [ ] **Phase 5: Cross-Environment Promotion (UI)** - One-click pipeline promotion across environments with secret pre-flight validation and approval workflow
- [ ] **Phase 6: OpenAPI Specification** - Auto-generated OpenAPI 3.1 spec from existing REST v1 routes and marked tRPC procedures
- [ ] **Phase 7: Cross-Environment Promotion (GitOps)** - Setup wizard, PR-based promotion via GitHub, and merge-triggered auto-deployment

## Phase Details

### Phase 1: Fleet Performance Foundation
**Goal**: The platform handles 100+ node fleets without heartbeat latency, SSE connection leaks, or redundant alert evaluation queries
**Depends on**: Nothing (first phase)
**Requirements**: PERF-01, PERF-02, PERF-03, PERF-04
**Success Criteria** (what must be TRUE):
  1. Fleet alert rules evaluate once per poll cycle in FleetAlertService — no alert evaluation code runs inside the heartbeat route
  2. SSE connections that close without TCP FIN are detected and evicted within one ping interval, keeping the active connection count accurate
  3. A new SSE connection is gracefully rejected (with a clear error) when the per-instance limit is reached, preventing file descriptor exhaustion
  4. The Vector component catalog is served from a module-level cache — repeated requests for pipeline list do not re-parse the catalog JSON
**Plans:** 2/2 plans complete
Plans:
- [x] 01-01-PLAN.md — Remove per-heartbeat alert evaluation (PERF-01) and verify SSE ghost connection handling (PERF-02)
- [x] 01-02-PLAN.md — Add SSE connection limit (PERF-03) and convert catalog to lazy singleton (PERF-04)

### Phase 2: Fleet Organization
**Goal**: Administrators can segment nodes into labeled groups with auto-enrollment and enforcement, and users can organize 200+ pipelines into nested folders with bulk tag operations
**Depends on**: Phase 1
**Requirements**: ORG-01, ORG-02, ORG-03, ORG-04, NODE-01, NODE-02, NODE-03
**Success Criteria** (what must be TRUE):
  1. Admin can create a node group and newly enrolled nodes matching the group's criteria are automatically assigned to it with the group's label template applied
  2. Admin can define required labels and the fleet view shows which nodes are non-compliant (warn mode — does not block heartbeat)
  3. User can create a pipeline sub-group inside a parent group and navigate back via a breadcrumb trail in the sidebar
  4. User can select multiple pipelines and add or remove a tag across all of them in one operation, with a progress indicator and a summary of any partial failures
**Plans:** 4 plans
Plans:
- [x] 02-01-PLAN.md — Schema migration (NodeGroup + PipelineGroup parentId) + NodeGroup router + enrollment auto-assignment + label compliance
- [x] 02-02-PLAN.md — PipelineGroup parentId/depth guard + bulk tag procedures (bulkAddTags/bulkRemoveTags)
- [x] 02-03-PLAN.md — Node group management UI in fleet settings + compliance badges
- [x] 02-04-PLAN.md — Pipeline sidebar tree + breadcrumbs + bulk tag UI in action bar
**UI hint**: yes

### Phase 3: Fleet Health Dashboard
**Goal**: The fleet page presents an aggregated, scannable health view for 100+ nodes organized by group, with drill-down to per-node detail
**Depends on**: Phase 2
**Requirements**: NODE-04, NODE-05
**Success Criteria** (what must be TRUE):
  1. Fleet dashboard loads with a group-level summary (online count, alert count, label-compliance rate) without issuing one query per node
  2. User can click a node group to see per-node status, uptime, CPU load, and label compliance in a grid or table view
  3. User can filter the dashboard by node group, label key/value, or compliance status to isolate problem nodes in a 100+ node fleet
**Plans:** 2/2 plans complete
Plans:
- [x] 03-01-PLAN.md — Backend: groupHealthStats + nodesInGroup tRPC procedures with shared nodeMatchesGroup util + unit tests
- [x] 03-02-PLAN.md — Frontend: Fleet health dashboard UI with group cards, expand/collapse drill-down, filter toolbar, URL params + docs
**UI hint**: yes

### Phase 4: Outbound Webhooks
**Goal**: Administrators can subscribe external systems to VectorFlow lifecycle events with reliable, HMAC-signed delivery and full audit history
**Depends on**: Phase 1
**Requirements**: HOOK-01, HOOK-02, HOOK-03, HOOK-04
**Success Criteria** (what must be TRUE):
  1. Admin can create a webhook subscription for any supported event type (deploy completed, pipeline crashed, node offline, alert fired, promotion completed) and the subscription appears in the management UI
  2. Failed webhook deliveries are retried with exponential backoff; deliveries that fail permanently (4xx non-429, DNS failure) are moved to dead-letter immediately without blocking retries for other subscriptions
  3. Every webhook request carries an HMAC-SHA256 signature header following the Standard-Webhooks spec so receivers can verify authenticity
  4. Admin can view the delivery history for a subscription — timestamp, HTTP status, attempt number — and trigger a test delivery from the UI
**Plans**: 3/3 plans complete
Plans:
- [x] 04-01-PLAN.md — WebhookEndpoint + WebhookDelivery Prisma models, Standard-Webhooks delivery service, dead-letter classification
- [x] 04-02-PLAN.md — webhookEndpoint tRPC router (CRUD, testDelivery, listDeliveries), event wiring, retry service extension
- [x] 04-03-PLAN.md — Webhook management UI (/settings/webhooks), delivery history panel, public docs

### Phase 5: Cross-Environment Promotion (UI)
**Goal**: Users can promote a pipeline from one environment to another via the UI with secret validation, substitution preview, and an approval workflow — without any git setup required
**Depends on**: Phase 4
**Requirements**: PROMO-01, PROMO-02, PROMO-03, PROMO-04, PROMO-05, PROMO-06
**Success Criteria** (what must be TRUE):
  1. User sees a "Promote to [env]" action on any pipeline and can initiate promotion in one click
  2. Promotion is blocked with a named error listing missing secrets if any SECRET[name] references in the pipeline do not exist in the target environment — no write occurs until all secrets are mapped
  3. Before confirming, user sees a substitution diff showing exactly which secret keys and variable values will change in the target environment
  4. Promotion creates a PromotionRequest that goes through the existing approval workflow before the cloned pipeline appears in the target environment
  5. Each pipeline shows a promotion history log: source environment, target environment, who promoted, and when
**Plans:** 1/3 plans executed
Plans:
- [x] 05-01-PLAN.md — PromotionRequest Prisma model, promotion service (preflight, clone, execute), tRPC router with unit tests
- [x] 05-02-PLAN.md — Multi-step PromotePipelineDialog, promotion history on pipeline detail page, public docs
- [ ] 05-03-PLAN.md — Human verification of complete promotion flow
**UI hint**: yes

### Phase 6: OpenAPI Specification
**Goal**: VectorFlow exposes a machine-readable OpenAPI 3.1 spec covering its REST v1 surface, usable by external integrators and CI/CD pipelines without reverse-engineering the API
**Depends on**: Phase 1
**Requirements**: API-01, API-02, API-03
**Success Criteria** (what must be TRUE):
  1. Running the build produces a valid OpenAPI 3.1 JSON/YAML artifact that can be imported into tools like Postman or Stoplight without errors
  2. Every existing REST v1 endpoint appears in the spec with its authentication scheme, request schema, and at least one example response
  3. tRPC procedures explicitly marked for public exposure appear in the spec with correct Zod-derived request and response schemas
**Plans**: TBD

### Phase 7: Cross-Environment Promotion (GitOps)
**Goal**: GitOps-native teams can promote pipelines via pull requests — a setup wizard guides git provider connection, promotion creates a PR in GitHub, and merging the PR auto-deploys to the target environment
**Depends on**: Phase 5
**Requirements**: GIT-01, GIT-02, GIT-03, GIT-04, GIT-05
**Success Criteria** (what must be TRUE):
  1. Admin can complete the in-app GitOps setup wizard and it validates the connection by performing a read and a dry-run webhook test before saving
  2. When a user promotes a pipeline, VectorFlow creates a pull request in the configured GitHub repository with the target environment folder updated to the promoted config
  3. Merging the PR in GitHub triggers VectorFlow's webhook handler to automatically deploy the promoted config to the target environment
  4. Teams without GitOps configured can still promote via the UI (Phase 5) — GitOps setup is never required for UI promotion to work
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

Note: Phase 3 depends on Phase 2. Phases 4 and 6 only depend on Phase 1 and can be pulled forward if needed. Phase 7 depends on Phase 5.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Fleet Performance Foundation | 2/2 | Complete   | 2026-03-26 |
| 2. Fleet Organization | 0/4 | Planned | - |
| 3. Fleet Health Dashboard | 0/2 | Planned | - |
| 4. Outbound Webhooks | 3/3 | Complete | 2026-03-27 |
| 5. Cross-Environment Promotion (UI) | 1/3 | In Progress|  |
| 6. OpenAPI Specification | 0/? | Not started | - |
| 7. Cross-Environment Promotion (GitOps) | 0/? | Not started | - |
