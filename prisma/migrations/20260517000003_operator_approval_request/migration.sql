-- OperatorApprovalRequest: generic 2-person approval primitive for
-- operator-side dual-control actions (e.g. backup restore, force
-- hard-delete, key rotation). The operation type is a free-form string;
-- the caller interprets payload.

CREATE TABLE "OperatorApprovalRequest" (
    "id"                     TEXT NOT NULL,
    "operation"              TEXT NOT NULL,
    "payload"                JSONB NOT NULL,
    "organizationId"         TEXT,
    "requestedByOperatorId"  TEXT NOT NULL,
    "approvedByOperatorId"   TEXT,
    "reason"                 TEXT NOT NULL,
    "executedByOperatorId"   TEXT,
    "status"                 TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "failureReason"          TEXT,
    "requestedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt"             TIMESTAMP(3),
    "executedAt"             TIMESTAMP(3),
    "completedAt"            TIMESTAMP(3),
    "expiresAt"              TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatorApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- Indices for the cron sweep + operator-console list views.
CREATE INDEX "OperatorApprovalRequest_status_expiresAt_idx"
  ON "OperatorApprovalRequest"("status", "expiresAt");
CREATE INDEX "OperatorApprovalRequest_organizationId_idx"
  ON "OperatorApprovalRequest"("organizationId");
CREATE INDEX "OperatorApprovalRequest_operation_idx"
  ON "OperatorApprovalRequest"("operation");
CREATE INDEX "OperatorApprovalRequest_requestedByOperatorId_idx"
  ON "OperatorApprovalRequest"("requestedByOperatorId");

-- FKs:
--   organization → SetNull (org hard-delete shouldn't erase the audit
--     trail of approval requests against it; the operator history
--     outlives the org).
--   requestedByOperator → Cascade (an operator being decommissioned
--     cancels their requests; the historical record is in the per-
--     event audit log, not on this table).
--   approvedByOperator + executedByOperator → SetNull (same audit
--     rationale; the approver / executor history is on PlatformAuditLog).
ALTER TABLE "OperatorApprovalRequest" ADD CONSTRAINT "OperatorApprovalRequest_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OperatorApprovalRequest" ADD CONSTRAINT "OperatorApprovalRequest_requestedByOperatorId_fkey"
  FOREIGN KEY ("requestedByOperatorId") REFERENCES "PlatformOperator"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperatorApprovalRequest" ADD CONSTRAINT "OperatorApprovalRequest_approvedByOperatorId_fkey"
  FOREIGN KEY ("approvedByOperatorId") REFERENCES "PlatformOperator"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OperatorApprovalRequest" ADD CONSTRAINT "OperatorApprovalRequest_executedByOperatorId_fkey"
  FOREIGN KEY ("executedByOperatorId") REFERENCES "PlatformOperator"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
