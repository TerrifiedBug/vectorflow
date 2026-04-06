# Backend API & Data Layer Audit (V-11)

**Date:** 2026-04-06
**Scope:** tRPC routers, Prisma schema, API error handling, tech debt/TODOs, dependency versions
**Findings:** 2 HIGH · 9 MEDIUM · 9 LOW

---

## Summary Table

| # | Finding | Severity | File | Lines |
|---|---------|----------|------|-------|
| 1 | `withTeamAccess` fires 14–17 serial DB queries per protected request | HIGH | `src/trpc/init.ts` | 120–425 |
| 2 | Audit middleware swallows write errors — silent audit trail gaps | HIGH | `src/server/middleware/audit.ts` | 355, 372, 392, 438, 448 |
| 3 | `protectedProcedure` in audit router exposes cross-team data | MEDIUM | `src/server/routers/audit.ts` | 125–154, 314–338 |
| 4 | `_def.procedures` spread uses tRPC internals — upgrade fragility | MEDIUM | `src/server/routers/pipeline.ts`, `alert.ts` | 25–30, 21–25 |
| 5 | `next-auth 5.0.0-beta.30` — beta in production | MEDIUM | `package.json` | 47 |
| 6 | `TeamMember.teamId` missing `onDelete` — blocks team deletion | MEDIUM | `prisma/schema.prisma` | 119 |
| 7 | `DeployRequest.reviewedBy` missing `onDelete: SetNull` | MEDIUM | `prisma/schema.prisma` | 864 |
| 8 | `Template` missing `@@index([teamId])` + cascade — full scan + blocks deletion | MEDIUM | `prisma/schema.prisma` | 696–706 |
| 9 | 7+ status fields use bare `String` instead of enums; casing inconsistency | MEDIUM | `prisma/schema.prisma` | 498, 657, 862, 886, 921, 1260 |
| 10 | Silent `catch {}` blocks in services swallow errors | MEDIUM | `src/server/services/*` | various |
| 11 | `console.error` bypasses structured logger | MEDIUM | `error-context.ts`, `log-ingest.ts` | 67, 58 |
| 12 | `requireRole` uses global max-role, not team-scoped | LOW | `src/trpc/init.ts` | 46–85 |
| 13 | `requireRole` exported but unused (dead code) | LOW | `src/trpc/init.ts` | 46 |
| 14 | `AnomalyEvent.acknowledgedBy/dismissedBy` bare strings, not FK | LOW | `prisma/schema.prisma` | 1263–1265 |
| 15 | Missing indexes on 5 FK columns | LOW | `prisma/schema.prisma` | various |
| 16 | No `@@map` decorators on any model | LOW | `prisma/schema.prisma` | all models |
| 17 | `vrl.ts` returns false success on `mkdtemp` failure | LOW | `src/server/routers/vrl.ts` | 49–52 |
| 18 | Encrypted DB fields are convention-only, not schema-enforced | LOW | `prisma/schema.prisma` | 84, 147, 774, 790 |
| 19 | Ignored CVE `GHSA-r5fr-rjxr-66jc` — needs documented rationale | LOW | `package.json` | 81 |
| 20 | `console.log` in test body pollutes test output | LOW | `src/server/services/__tests__/metrics-ingest.test.ts` | 720 |

---

## 1. tRPC Router Structure

### [HIGH] `withTeamAccess` Fires 14–17 Serial DB Queries Per Request

**File:** `src/trpc/init.ts:120–425`

The `withTeamAccess` middleware resolves team ownership from `input.id` via a waterfall of up to 14 sequential `prisma.findUnique` calls (one per entity type: `pipeline`, `environment`, `vectorNode`, `template`, `alertRule`, `alertWebhook`, `pipelineGroup`, `notificationChannel`, `serviceAccount`, `vrlSnippet`, `alertCorrelationGroup`, `team`), followed by `user.findUnique` + `teamMember.findUnique`. In the worst case, every protected mutation that uses ID-based resolution runs 16+ DB round-trips before the procedure body.

**Recommendation:** Use a unified "resolve entity owner" query (single `UNION`-style raw query or a lookup table keyed by entity type), or require callers to pass `teamId` explicitly in input.

---

### [MEDIUM] `_def.procedures` Spread Uses tRPC Internal API

**Files:** `src/server/routers/pipeline.ts:25–30`, `src/server/routers/alert.ts:21–25`

```ts
// anti-pattern
export const pipelineRouter = router({
  ...pipelineCrudRouter._def.procedures,
  ...pipelineVersionsRouter._def.procedures,
});
```

`_def` is an undocumented internal tRPC property. This pattern flattens sub-routers into a single namespace but will break silently on tRPC major version upgrades.

**Recommendation:** Use nested sub-router namespaces (`router({ crud: pipelineCrudRouter, ... })`) or re-export procedures individually.

---

### [MEDIUM] Audit Router Exposes Cross-Team Data

**File:** `src/server/routers/audit.ts:125–154, 314–338`

Several audit procedures use bare `protectedProcedure` (authenticated, no team scope). These return data across all teams: actions, entityTypes, user emails, pipeline names, deployment summaries. Any authenticated user can enumerate this data.

**Recommendation:** Apply `withTeamAccess("VIEWER")` to all audit procedures, or filter results by team membership.

---

### [LOW] `requireRole` Uses Global Max-Role, Not Team-Scoped Role

**File:** `src/trpc/init.ts:46–85`

`requireRole` resolves the user's highest role across _all_ team memberships. A user who is ADMIN of Team A but VIEWER of Team B satisfies `requireRole("ADMIN")` for Team B operations.

**Recommendation:** Ensure all mutations use `withTeamAccess` (which is team-scoped) rather than the global `requireRole`.

---

### [LOW] `requireRole` Is Exported But Unused

**File:** `src/trpc/init.ts:46`

Dead export — no routers call `requireRole` directly (all use `withTeamAccess` or `requireSuperAdmin`). Should be removed.

---

## 2. Prisma Schema Health

### [MEDIUM] `TeamMember.teamId` Missing `onDelete` — Blocks Team Deletion

**File:** `prisma/schema.prisma:119`

No `onDelete` specified on the team relation. Prisma defaults to `Restrict`, preventing team deletion while members exist. The `userId` side (line 118) correctly has `onDelete: Cascade`.

**Fix:** Add `onDelete: Cascade` to the team relation on `TeamMember`.

---

### [MEDIUM] `DeployRequest.reviewedBy` Missing `onDelete: SetNull`

**File:** `prisma/schema.prisma:864`

Nullable reviewer relation uses `Restrict` default — a user who reviewed a deploy request cannot be deleted without first clearing that field.

**Fix:** Add `onDelete: SetNull`.

---

### [MEDIUM] `Template` Missing Index and Cascade Delete

**File:** `prisma/schema.prisma:696–706`

- No `@@index([teamId])` — every team-scoped template list is a full table scan.
- No `onDelete` on team relation — `Restrict` default blocks team deletion if templates exist.

**Fix:** Add `@@index([teamId])` and `onDelete: Cascade` (or `SetNull` if orphaned templates are valid).

---

### [MEDIUM] Status Fields Use Bare `String` Instead of Enums

Seven models use stringly-typed status values with no DB-level enforcement:

| Model | Field | Line | Issue |
|-------|-------|------|-------|
| `EventSampleRequest` | `status` | 498 | Should be enum |
| `StagedRollout` | `status` | 657 | Should be enum |
| `DeployRequest` | `status` | 862 | Should be enum |
| `PromotionRequest` | `status` | 886 | Should be enum |
| `GitSyncJob` | `status` | 921 | Lowercase values (`"pending"`) — inconsistent with rest of schema which uses UPPER_CASE |
| `AnomalyEvent` | `status` | 1260 | Should be enum |
| `BackupRecord` | `status` | ~798 | Should be enum |

**Fix:** Define Prisma enums for each distinct status type. Standardize casing to UPPER_CASE across all status values.

---

### [LOW] Missing Indexes on Foreign Keys

| Model | Missing Index | Impact |
|-------|--------------|--------|
| `Template` | `@@index([teamId])` | Full scans on team-scoped template queries |
| `Account` | `@@index([userId])` | NextAuth session lookup full scans |
| `NodePipelineStatus` | `@@index([pipelineId])` | Pipeline-scoped status lookups |
| `AlertRuleChannel` | `@@index([alertRuleId])`, `@@index([channelId])` | Rule-to-channels and channel-to-rules queries |
| `ScimGroupMember` | `@@index([userId])` | Reverse group membership lookups |

---

### [LOW] `AnomalyEvent.acknowledgedBy/dismissedBy` Are Bare Strings

**File:** `prisma/schema.prisma:1263–1265`

If these store user IDs, they should be FK relations with `onDelete: SetNull`. If they store display names, rename to `acknowledgedByName`/`dismissedByName` to clarify intent.

---

### [LOW] No `@@map` Decorators on Any Model

All Postgres table names are PascalCase (e.g. `VectorNode`, `PipelineLog`). Raw SQL queries and model renames without migrations are fragile.

---

### [LOW] Encrypted Field Convention Not Schema-Enforced

**File:** `prisma/schema.prisma:84, 147, 774, 790`

Fields like `gitToken`, `aiApiKey`, `s3SecretAccessKey`, `scimBearerToken`, `oidcClientSecret` have comments saying "Encrypted via crypto.ts" but nothing prevents unencrypted writes via raw Prisma calls.

---

## 3. API Error Handling

### [HIGH] Audit Middleware Swallows Write Errors Silently

**File:** `src/server/middleware/audit.ts:355, 372, 392, 438, 448`

Empty `catch {}` blocks around audit log writes produce no logs, no metrics, no alerts. Failed audit writes are invisible operationally — compliance and security audit trails may have silent gaps.

**Recommendation:** At minimum, log failures at `error` level. Consider a dead-letter queue or secondary write path for audit events.

---

### [MEDIUM] Silent `catch {}` Blocks in Services

The following locations swallow errors with no logging:

| File | Lines | Context |
|------|-------|---------|
| `src/server/services/webhook-delivery.ts` | 64 | Delivery failure |
| `src/server/services/anomaly-detector.ts` | 77 | Detection failure |
| `src/server/services/backup.ts` | 112, 129, 343, 472, 543, 634, 759 | Multiple backup operations |
| `src/server/services/redis-pubsub.ts` | 156 | Pub/sub failure |
| `src/server/services/migration/ai-translator.ts` | 597, 603 | AI translation failures |
| `src/server/services/pipeline-graph.ts` | 515 | Graph operation failure |
| `src/server/services/group-mappings.ts` | 35 | OIDC group mapping parse failure |

**Recommendation:** Replace `catch {}` with `catch (err) { errorLog(..., err) }` at minimum.

---

### [MEDIUM] `console.error` Bypasses Structured Logger

**Files:** `src/server/services/error-context.ts:67`, `src/server/services/log-ingest.ts:58`

Two `console.error` calls bypass the project's `errorLog` helper in `src/lib/logger.ts`, which adds structured timestamps and log-level gating.

**Fix:** Replace with `errorLog("module-name", "message", err)`.

---

### [LOW] `vrl.ts` Returns False Success on `mkdtemp` Failure

**File:** `src/server/routers/vrl.ts:49–52`

If temp directory creation fails (e.g. disk full), the handler returns `{ errors: [] }` — indistinguishable from a successful validation with no errors.

**Fix:** Throw `new TRPCError({ code: "INTERNAL_SERVER_ERROR" })` instead.

---

## 4. Tech Debt / TODOs

- **Zero TODO/FIXME/HACK comments** in `src/server/**` — clean.
- **No hardcoded secrets** found anywhere in backend source.
- Schema has roadmap placeholders in comments (`prisma/schema.prisma:550–552`) that could become tracked issues.
- One `console.log` in test body at `src/server/services/__tests__/metrics-ingest.test.ts:720` pollutes test output.

---

## 5. Dependency Versions

| Package | Version | Note |
|---------|---------|------|
| `next` | 16.1.7 | Current |
| **`next-auth`** | **5.0.0-beta.30** | **Beta in production — track stable release** |
| `@trpc/server` | ^11.8.0 | Current |
| `@prisma/client` | ^7.6.0 | Current |
| `zod` | ^4.3.6 | Current |
| `react` | 19.2.3 | Current |
| `ioredis` | ^5.10.1 | Current |

**pnpm overrides** (security patches on transitive deps — good practice):
- `hono >=4.11.10`
- `lodash >=4.18.1`
- `dompurify >=3.3.2`
- `path-to-regexp >=8.4.0`

**Ignored CVE** `GHSA-r5fr-rjxr-66jc` in `pnpm.auditConfig.ignoreCves` — suppression should have a documented rationale (comment or linked issue explaining why it's acceptable to ignore).
