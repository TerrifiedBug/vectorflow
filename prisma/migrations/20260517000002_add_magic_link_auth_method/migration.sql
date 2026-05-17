-- Phase 5y follow-up: add MAGIC_LINK variant to the AuthMethod enum so
-- magic-link sign-in can be recorded as the provisioning method on User.
--
-- Backfill: none required. Existing users provisioned via magic link will
-- retain authMethod = LOCAL (the default). The new value is only written
-- for net-new users provisioned during a magic-link flow.
--
-- Index impact: AuthMethod is not indexed independently; no index changes.
--
-- TimescaleDB: not a hypertable column. Plain PostgreSQL enum extension.
-- `ADD VALUE IF NOT EXISTS` is idempotent across re-runs.
--
-- Rollback: enum values cannot be removed from PostgreSQL without dropping
-- and recreating the type (which requires rebuilding all dependent columns).
-- The safe rollback is to omit the value from application code and treat
-- any MAGIC_LINK rows as LOCAL for display purposes, pending a maintenance
-- window to perform the type rebuild.

ALTER TYPE "AuthMethod" ADD VALUE IF NOT EXISTS 'MAGIC_LINK';
