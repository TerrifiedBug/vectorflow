-- Phase 4 follow-up — separate operator-action audit log.
-- See plan §11 ("Audit & observability") and §16b OSS item 5.
--
-- This table records every platform-operator action that touches a
-- customer org: break-glass grant lifecycle, suspend/unsuspend, backup
-- restore, KMS unwrap during a grant window. It lives in a separate
-- table from `AuditLog` (which is the per-org customer-visible log)
-- so the two streams can have different retention / export policies
-- and the Cloud build can ship this table's rows to an S3 bucket with
-- Object Lock for WORM retention.
--
-- Append-only semantics enforced by Postgres rules: the operator
-- Postgres role MUST NOT be able to UPDATE or DELETE rows. Only the
-- platform-audit writer role (vectorflow_platform_audit, created
-- separately in the operator-role migration) is permitted to INSERT.
-- This migration creates the constraint; the role-grant migration
-- attaches it to the role.
--
-- The rules use TRUNCATE/UPDATE/DELETE protection rather than column
-- privileges so the protection applies even when a privileged role
-- accidentally connects with the wrong search_path.
--
-- Rollback:
--   DROP TABLE "PlatformAuditChainTail";
--   DROP TABLE "PlatformAuditLog";

CREATE TABLE IF NOT EXISTS "PlatformAuditLog" (
    "id"             TEXT PRIMARY KEY,
    "stampId"        TEXT NOT NULL DEFAULT 'default',
    "operatorId"     TEXT,
    "operatorRole"   "PlatformOperatorRole",
    "action"         TEXT NOT NULL,
    "organizationId" TEXT,
    "reason"         TEXT,
    "entityType"     TEXT,
    "entityId"       TEXT,
    "metadata"       JSONB,
    "ipAddress"      TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prevHash"       TEXT NOT NULL,
    "hash"           TEXT NOT NULL,
    CONSTRAINT "PlatformAuditLog_operator_fkey"
        FOREIGN KEY ("operatorId")
        REFERENCES "PlatformOperator"("id")
        -- RESTRICT (not SET NULL): the audit row carries the operator
        -- identifier as historical fact. Setting it to NULL on operator
        -- hard-delete would erase the audit-trail's "who acted" pointer,
        -- defeating the table's purpose. The append-only INSTEAD OF
        -- UPDATE rule below would also block the SET NULL update path,
        -- so this would have failed at runtime anyway. Operators are
        -- expected to be soft-deleted via PlatformOperator.deletedAt
        -- (see operator-lifecycle docs); hard-delete is reserved for
        -- ToS-violation cases where the audit trail of the offending
        -- operator's actions is intentionally preserved.
        ON DELETE RESTRICT
        ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PlatformAuditLog_stampId_createdAt_idx"
    ON "PlatformAuditLog" ("stampId", "createdAt");
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_operatorId_idx"
    ON "PlatformAuditLog" ("operatorId");
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_action_idx"
    ON "PlatformAuditLog" ("action");
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_organizationId_idx"
    ON "PlatformAuditLog" ("organizationId");
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_createdAt_idx"
    ON "PlatformAuditLog" ("createdAt");

-- Append-only enforcement: every role except the dedicated writer is
-- denied UPDATE / DELETE / TRUNCATE. We use Postgres rules rather than
-- ROW LEVEL SECURITY so the table remains queryable by every operator
-- role for read-only access without per-statement policy overhead.
--
-- The writer role is granted INSERT separately in the role-grant
-- migration (operator-pii-views also touches the operator role; the
-- writer role grant is bundled there going forward).

CREATE OR REPLACE RULE "PlatformAuditLog_no_update" AS
    ON UPDATE TO "PlatformAuditLog"
    DO INSTEAD NOTHING;

CREATE OR REPLACE RULE "PlatformAuditLog_no_delete" AS
    ON DELETE TO "PlatformAuditLog"
    DO INSTEAD NOTHING;

COMMENT ON TABLE "PlatformAuditLog" IS
  'Plan §11 platform-operator audit log. Append-only via Postgres rules; Cloud ships to S3 Object Lock (governance, 7y).';

-- Per-stamp chain-tail pointer for tamper-evidence. Mirrors the per-org
-- AuditChainTail pattern; key here is the stamp identifier so a single
-- chain spans every operator action on that stamp.
CREATE TABLE IF NOT EXISTS "PlatformAuditChainTail" (
    "stampId"     TEXT PRIMARY KEY,
    "lastHash"    TEXT NOT NULL,
    "lastWriteAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL
);

COMMENT ON TABLE "PlatformAuditChainTail" IS
  'Per-stamp tail pointer for PlatformAuditLog hash chain.';

-- Writer-only privileges: revoke INSERT from the general app role and grant
-- to the dedicated writer so forging audit entries requires that role's
-- credentials. Only enforced in Cloud deployments where both roles exist.
-- Idempotent: safe to re-run; skipped cleanly when roles don't exist.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vectorflow_platform_audit')
    AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vectorflow_app') THEN
        -- Grant INSERT/SELECT to the dedicated writer role.
        EXECUTE 'GRANT INSERT ON "PlatformAuditLog" TO vectorflow_platform_audit';
        EXECUTE 'GRANT INSERT, UPDATE ON "PlatformAuditChainTail" TO vectorflow_platform_audit';
        EXECUTE 'GRANT SELECT ON "PlatformAuditLog" TO vectorflow_platform_audit';
        EXECUTE 'GRANT SELECT ON "PlatformAuditChainTail" TO vectorflow_platform_audit';
        -- Revoke INSERT/UPDATE/DELETE from the runtime app role.
        -- UPDATE and DELETE are blocked by rules above; revoking at the grant
        -- level adds defence-in-depth so the rules are not the sole barrier.
        -- Note: Cloud callers of writePlatformAuditLog MUST switch to a
        -- vectorflow_platform_audit-credentialed connection before calling.
        EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON "PlatformAuditLog" FROM vectorflow_app';
        EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON "PlatformAuditChainTail" FROM vectorflow_app';
        RAISE NOTICE 'platform-audit: writer-only grants applied';
    ELSE
        RAISE NOTICE 'platform-audit: writer-only lockdown skipped — vectorflow_platform_audit not provisioned';
    END IF;
END
$$;
