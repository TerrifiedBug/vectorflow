-- Phase 5y: magic-link sign-in tokens.
--
-- Backfill: none required — net-new table, no rows to seed.
--
-- Index strategy:
--   - tokenHash UNIQUE: the redeem endpoint hashes the incoming token and
--     looks it up; a constraint violation is the right way to fail when a
--     token has been replayed-after-consumption.
--   - (organizationId, email) composite: per-org rate-limit + lookup-by-email
--     for the SCIM provisioning / new-user bootstrap path.
--   - expiresAt: periodic GC sweep deletes consumed + expired rows.
--
-- TimescaleDB: not a hypertable. Tokens are short-lived (~10min TTL); the
-- table stays tiny.
--
-- Rollback: drop the table.

CREATE TABLE "MagicLinkToken" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "email"          TEXT NOT NULL,
  "tokenHash"      TEXT NOT NULL,
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  "consumedAt"     TIMESTAMP(3),
  "requestIp"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MagicLinkToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MagicLinkToken_tokenHash_key"
  ON "MagicLinkToken"("tokenHash");
CREATE INDEX "MagicLinkToken_organizationId_email_idx"
  ON "MagicLinkToken"("organizationId", "email");
CREATE INDEX "MagicLinkToken_expiresAt_idx"
  ON "MagicLinkToken"("expiresAt");

ALTER TABLE "MagicLinkToken"
  ADD CONSTRAINT "MagicLinkToken_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
