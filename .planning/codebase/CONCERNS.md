# Codebase Concerns

**Analysis Date:** 2026-03-22

## Tech Debt

### Silent Error Handlers

**Issue:** 33+ locations silently swallow errors using `.catch(() => {})` pattern.

Files with patterns:
- `src/auth.ts` - Lines 91, 98, 110, 144, 152, 229, 237, 308, 341 (9 instances in auth flow)
- `src/app/api/ai/vrl-chat/route.ts` - Line 215
- `src/app/api/ai/pipeline/route.ts` - Line 229
- `src/server/services/validator.ts` - Line 55
- `src/server/services/backup.ts` - Lines 283-284 (file cleanup)
- `src/server/services/version-check.ts` - Line 147
- `src/server/services/git-sync.ts` - Lines 113, 166
- `src/app/api/v1/alerts/rules/route.ts` - Line 122
- `src/app/api/v1/pipelines/[id]/rollback/route.ts` - Line 64
- `src/app/api/v1/pipelines/[id]/undeploy/route.ts` - Line 43
- `src/server/services/backup-scheduler.ts` - Line 61
- `src/app/api/v1/secrets/route.ts` - Lines 83, 155

**Impact:** Failures in critical paths (auth logging, backup, git sync, AI requests) are completely hidden. Difficult to diagnose production issues. Audit log writes fail silently.

**Fix approach:** Replace with proper logging and selective error isolation. Only use silent catch for cleanup operations (file deletion). For application logic, log errors with context even if they're non-blocking.

### Type Safety Issues (Any Types)

**Issue:** Auth module caches NextAuth instance using `any` types.

Files:
- `src/auth.ts` - Lines 168-169
  - `type AuthInstance = { handlers: any; auth: any; signIn: any; signOut: any }`
  - Lines 376, 382, 388 (additional eslint-disable comments)

**Impact:** Type-checking disabled in critical auth infrastructure. Difficult to catch auth-related bugs at compile time.

**Fix approach:** Create proper TypeScript types for NextAuth handlers instead of using `any`. Reference NextAuth's own types.

### Unresolved TODOs

**Certificate Expiration Monitoring (Certificate_Expiring Alert)**

File: `src/server/services/event-alerts.ts` - Lines 117-121

**Issue:** Certificate expiry alert is defined in the alert system but never implemented. Certificates are stored as encrypted PEM blobs without parsed expiry metadata. No periodic job checks for certificate expiration.

**Impact:** Users can set up certificate_expiring alert rules but they will never fire. Certificates can silently expire in production. No way to detect certificate approaching expiration until it fails.

**Fix approach:**
1. Add `expiryDate` field to Certificate model (parsed from PEM)
2. Create periodic job (hourly) that queries certificates and fires event alert when within N days of expiration
3. Parse PEM notAfter date when certificate is created/updated
4. Update alert documentation to clarify this alert now works

## Known Bugs

### Concurrent Audit Log Write Suppression

**Issue:** Audit logging operations are awaited with silent failure handling.

File: `src/auth.ts` - Multiple locations
- Failed logins/successful logins write audit logs with `.catch(() => {})`
- User lock events, TOTP failures all silently fail to log

**Trigger:** Write audit log during auth flow → logging service error (DB connection, permissions) → silently ignored

**Workaround:** None. Audit trail is incomplete when logging fails, but user login still succeeds.

**Fix:** Queue audit logs with retry logic instead of fire-and-forget.

### VRL Chat Conversation Isolation Gap

**Issue:** Conversation persistence creates a new conversation every time if conversationId not provided, but there's no validation that conversation permissions still match the pipeline.

File: `src/app/api/ai/vrl-chat/route.ts` - Lines 86-100

**Trigger:** User A creates conversation on pipeline P → conversation persisted to DB with userId A. User B (same team) reuses old conversationId → can read User A's VRL drafts and chat history.

**Risk:** Cross-user conversation history leakage if conversationId is predictable or leaked.

**Fix:** When resuming conversation, re-validate user's access to the pipeline and add permission check on conversation load.

## Security Considerations

### Silent JSON.parse in Multiple Locations

**Issue:** Untrusted JSON parsing without try-catch in user-facing code:

Files:
- `src/app/(dashboard)/alerts/page.tsx` - Lines 693, 889, 1460 (parsing webhook headers from form)
- `src/stores/flow-store.ts` - Line 715 (parsing clipboard data)
- `src/server/routers/settings.ts` - Line 73 (parsing OIDC team mappings)
- `src/server/routers/vrl.ts` - Lines 31, 74 (parsing VRL input/output)
- `src/server/routers/user.ts` - Line 241 (parsing backup codes)
- `src/server/services/group-mappings.ts` - Line 24

**Current State:** Most have try-catch wrapping, but not all. Headers parsing in alerts page is particularly risky.

**Risk:** Malformed JSON in webhook headers → unhandled parse error → 500 error exposing stack trace

**Recommendation:** Wrap all JSON.parse in try-catch. Use Zod for schema validation after parsing.

### Direct Environment Variable Access (30+ locations)

**Issue:** Code directly reads `process.env.*` throughout codebase rather than using centralized config.

**Impact:** Difficult to audit which env vars are required, difficult to validate at startup, impossible to mock in tests.

**Recommendation:** Create `src/lib/config.ts` that validates all required env vars at startup using Zod, exports typed config object.

### Command Execution in Backup and Git Services

Files with potential injection risks:
- `src/server/services/backup.ts` - Uses `execFile` with parsed DATABASE_URL components (safer pattern)
- `src/server/services/git-sync.ts` - May spawn git commands

**Current State:** Database backup uses safe `execFile` with separate args array (not shell-injectable). Git operations need review.

**Recommendation:** Audit git-sync operations for injection. Use `execFile` (args array) never `exec` (shell string).

### Webhook Secret Validation

File: `src/app/api/webhooks/git/route.ts` - Line 51

**Issue:** Git webhook signature validation exists but may have timing attack vulnerability if using simple string comparison.

**Recommendation:** Verify webhook signature uses timing-safe comparison.

## Performance Bottlenecks

### Large File Heartbeat Processing (Pipeline metrics ingest)

File: `src/app/api/agent/heartbeat/route.ts` - ~600 lines

**Issue:** Single large endpoint handles agent authentication, pipeline validation, metrics ingest, log ingest, alert evaluation, and webhook delivery. No pagination for metrics.

**Current State:** Works in-process synchronously.

**Scaling concern:** At scale, heartbeat endpoint becomes bottleneck. 1000 agents × 1000 metrics/agent = 1M metric writes per heartbeat interval.

**Improvement path:**
1. Move metric ingest to background queue (Bull/RabbitMQ)
2. Move alert evaluation to separate service with caching
3. Batch metric writes into PipelineMetric inserts

### Database Indices for Time-Series Queries

File: `prisma/schema.prisma`

**Indices present:**
- PipelineMetric: `@@index([pipelineId, timestamp])`
- PipelineLog: `@@index([pipelineId, timestamp])`
- NodeMetric: `@@index([nodeId, timestamp])`

**Gap:** Missing backward time-range queries. When querying "last 24 hours of metrics for pipeline P" without filtering by componentId, needs to scan potentially millions of rows.

**Recommendation:** Add `@@index([pipelineId, timestamp desc])` for reverse chronological queries, or ensure query planner uses existing indices efficiently.

### Memory Usage of Flow Store

File: `src/stores/flow-store.ts` - 951 lines, manages entire pipeline as Zustand state

**Issue:** Large pipelines (100+ nodes, 500+ edges) held entirely in memory with full undo/redo history. MAX_HISTORY = 50 snapshots.

**At scale:** Each snapshot can be 100KB+, 50 snapshots = 5MB per pipeline in browser memory.

**Impact:** Slow UI for large pipelines, memory pressure on embedded devices.

**Recommendation:** Implement pagination/virtualization in flow canvas. Consider server-side undo/redo instead of client-side.

## Fragile Areas

### Migration History (69 migrations)

File: `prisma/migrations/` directory

**Risk:** 69 migrations suggests evolving schema. Key concerns:
- User model evolved from single auth method → OIDC + local with complex fallback logic
- Alert system evolved multiple times (multiple migration timestamps suggest schema churn)
- GitOps features added piecemeal (git fields scattered across Environment model)

**Safe modification:** When adding new fields, ensure they have defaults or are nullable. Test migration against production-like data volume.

### Pipeline Version Snapshots (New Feature)

File: `prisma/schema.prisma` mentions PipelineVersion with snapshots

**Risk:** Version snapshots may have incomplete historical data if feature recently added. Old pipelines may lack version snapshots.

**Safe modification:** Ensure queries handle null snapshots gracefully. Add migration to backfill snapshots for existing pipelines.

### Event-Based Alerts System

Files:
- `src/server/services/event-alerts.ts`
- `src/app/(dashboard)/alerts/page.tsx` (1910 lines, large component)

**Risk:** Alerts page is a mega-component with form state management for 6+ alert channel types. Heavy reliance on local form state leads to fragility when integrating new channel types.

**What breaks easily:**
- Adding new alert channel type requires changes in multiple places
- Form validation logic not extracted, spread across component
- Webhook header parsing in form component, not isolated

**Safe modification:** Extract alert form logic into separate composition. Create AlertChannelForm abstraction for each channel type. Test each channel type's form independently.

### Configuration Encryption/Decryption

Files involved:
- `src/server/services/config-crypto.ts` - Node config encryption
- `src/server/services/crypto.ts` - System-wide encryption (OIDC secrets, git tokens, TOTP)

**Risk:** Two separate crypto modules with potentially different implementations. No clear separation of concerns between config-level and secret-level encryption.

**Safe modification:** Ensure all encrypted fields are tracked in schema. Test encryption key rotation scenario. Document which fields are encrypted and where.

## Scaling Limits

### PostgreSQL Query Complexity (Heartbeat Endpoint)

**Current capacity:** ~100 agents, ~10 pipelines each, ~100 metrics per heartbeat

**Limit:** Query validates all pipeline ownership in memory. At 10,000 pipelines, this becomes slow.

```typescript
// src/app/api/agent/heartbeat/route.ts line 141-145
const validPipelineIds = new Set(
  (await prisma.pipeline.findMany({
    where: { environmentId: agent.environmentId },
    select: { id: true },
  })).map((p) => p.id),
);
```

**Scaling path:** Cache valid pipeline IDs for environment. Invalidate on pipeline create/delete.

### Alert Rule Querying (Event Alerts)

File: `src/server/services/event-alerts.ts` - Line 36

**Issue:** Every event fires a `fireEventAlert()` call that queries ALL matching alert rules for that environment + metric combination.

**Current:** Works fine for <100 rules per environment

**Limit:** At 1000+ alert rules per environment, each event causes expensive query

**Scaling path:**
1. Denormalize active rules by (environmentId, metric) into cache
2. Or use PostgreSQL LISTEN/NOTIFY for alert subscriptions
3. Or pre-compute alert eligibility during metric ingest

### Team-scoped Querying

Multiple routers use `withTeamAccess()` middleware which requires loading team membership for every query.

**Recommendation:** Add team context to session to avoid repeated lookups.

## Dependencies at Risk

### Next.js Crypto Utilities

**Risk:** Using Node.js crypto for password hashing (bcrypt) and encryption (crypto.ts). These are stable but require careful key management.

**Current state:** Uses `crypto.subtle` for AES-256-GCM encryption in `src/server/services/crypto.ts`.

**Mitigation:** Key rotation not documented. If key is compromised, all encrypted secrets are at risk.

**Migration plan:** Consider AWS KMS or HashiCorp Vault for key management in production.

### Prisma Client Generation (69 MB generated code)

File: `src/generated/prisma/`

**Risk:** Large generated types can cause slow TypeScript compilation if schema changes frequently

**Mitigation:** Already committed to repo, not ideal but works

**Recommendation:** Consider using Prisma Accelerate for query optimization layer.

## Missing Critical Features

### Backup Restoration Incomplete

File: `src/server/services/backup.ts`

**Issue:** `createBackup()` is implemented but `restoreBackup()` is partially implemented. No test for restoration.

**Impact:** Users can create backups but restoration path may fail in production. No recovery from catastrophic data loss.

**Blocks:** Disaster recovery testing, backup strategy validation

### Certificate Management Gaps

- No automatic certificate renewal
- No expiry notifications (as noted in TODO)
- No certificate rotation orchestration
- No CRL/OCSP support

**Blocks:** Long-term production deployment without manual intervention

### Git Sync Bidirectional Not Fully Tested

File: `src/server/services/git-sync.ts`

**Issue:** gitOpsMode can be "off" | "push" | "bidirectional" but bidirectional sync logic may be incomplete

**Recommendation:** Add integration tests for bidirectional sync conflicts.

## Test Coverage Gaps

### Auth Module

File: `src/auth.ts` - Complex credential provider with TOTP, backup codes, OIDC fallback

**Not tested:**
- TOTP verification edge cases (clock skew, code reuse)
- Backup code consumption atomicity
- OIDC group sync and role mapping
- Account locking logic
- Email verification (if applicable)

**Risk:** Password resets, 2FA, SSO integration failures won't be caught until production

**Priority:** High - affects all user access

### Event Alerts and Webhook Delivery

Files:
- `src/server/services/event-alerts.ts`
- `src/server/services/webhook-delivery.ts`
- `src/server/services/channels/index.ts`

**Not tested:**
- Alert rule matching logic (scoping to pipeline, environment)
- Webhook delivery retry logic
- Notification channel delivery (Slack, email, PagerDuty)
- Certificate expiry detection (when implemented)

**Risk:** Users configure alerts that never fire, or alerts fire for wrong pipelines

**Priority:** High - core monitoring feature

### Configuration Encryption

File: `src/server/services/crypto.ts`

**Not tested:**
- Key rotation scenario
- Decryption of old-format encrypted values
- IV (initialization vector) handling

**Risk:** Encrypted configs become unreadable after key rotation or migration

**Priority:** Medium - impacts secret management

### Large Component Behavior

Files:
- `src/app/(dashboard)/alerts/page.tsx` (1910 lines)
- `src/app/(dashboard)/settings/_components/team-settings.tsx` (865 lines)

**Not tested:** Form submission edge cases, validation, concurrent updates

**Priority:** Medium - causes UI bugs

### Backup and Restore Flow

File: `src/server/services/backup.ts`

**Not tested:**
- Actual backup creation and compression
- Restore from backup
- Backup with large databases (>1GB)
- Concurrent backup attempts (handled with mutex but not tested)

**Risk:** Backups created but unrecoverable, no warning before restore

**Priority:** High - affects data safety

---

*Concerns audit: 2026-03-22*
