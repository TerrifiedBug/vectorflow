-- Add composite `(organizationId, …)` btree indexes to the three new
-- tables that landed without one. `scripts/verify-indexes.sh` (CI gate)
-- flags any tenant table whose RLS predicate
-- `"organizationId" = current_setting('app.org_id', true)` would force
-- a Seq Scan because no composite index has organizationId leading.
--
-- Each composite is chosen as `(organizationId, <hottest 2nd key>)`:
--
-- BillingProviderRef:        (organizationId, provider)
--   The Cloud-side aggregator scans `WHERE provider='stripe' AND status='active'`
--   per org. Adding `provider` second lets the planner narrow on both
--   org and provider with one index seek.
--
-- OperatorApprovalRequest:   (organizationId, status)
--   The operator-console list view queries
--   `WHERE organizationId=? AND status IN ('PENDING_APPROVAL','APPROVED')`
--   for the active grants page. Status as the 2nd key skips
--   COMPLETED/FAILED/EXPIRED rows that dominate the table over time.
--
-- PlatformAuditLog:          (organizationId, createdAt)
--   The customer-facing "operator actions against my org" view orders by
--   createdAt DESC for the most recent entries. The pre-existing
--   (stampId, createdAt) composite serves the stamp-wide operator
--   timeline; this one is the per-org cut.

CREATE INDEX IF NOT EXISTS "BillingProviderRef_organizationId_provider_idx"
  ON "BillingProviderRef"("organizationId", "provider");

CREATE INDEX IF NOT EXISTS "OperatorApprovalRequest_organizationId_status_idx"
  ON "OperatorApprovalRequest"("organizationId", "status");

CREATE INDEX IF NOT EXISTS "PlatformAuditLog_organizationId_createdAt_idx"
  ON "PlatformAuditLog"("organizationId", "createdAt");
