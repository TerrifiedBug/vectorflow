-- Phase 5x: WebAuthn / passkey credentials and short-lived challenges.
--
-- Backfill: none required — both tables are net-new and have no foreign-key
-- dependents to repopulate. Existing users get no credentials by default;
-- they enroll one through the register flow.
--
-- Index strategy:
--   - WebAuthnCredential.credentialId UNIQUE so the assertion verifier can
--     resolve the user without an email round-trip.
--   - WebAuthnCredential.userId indexed for the list-my-credentials UI.
--   - WebAuthnChallenge.expiresAt indexed for the periodic GC sweep.
--   - WebAuthnChallenge.challenge UNIQUE so replay of a captured challenge
--     fails with a constraint violation instead of an opaque downstream
--     error.
--
-- TimescaleDB: neither table is a hypertable — they're tiny operational
-- state, not time-series.
--
-- Rollback: drop the two tables. No backfill to revert.

CREATE TABLE "WebAuthnCredential" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "credentialId"  TEXT NOT NULL,
  "publicKey"     BYTEA NOT NULL,
  "counter"       BIGINT NOT NULL DEFAULT 0,
  "transports"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "deviceType"    TEXT,
  "backedUp"      BOOLEAN NOT NULL DEFAULT false,
  "name"          TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt"    TIMESTAMP(3),
  CONSTRAINT "WebAuthnCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebAuthnCredential_credentialId_key"
  ON "WebAuthnCredential"("credentialId");
CREATE INDEX "WebAuthnCredential_userId_idx"
  ON "WebAuthnCredential"("userId");
CREATE INDEX "WebAuthnCredential_credentialId_idx"
  ON "WebAuthnCredential"("credentialId");

ALTER TABLE "WebAuthnCredential"
  ADD CONSTRAINT "WebAuthnCredential_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WebAuthnChallenge" (
  "id"        TEXT NOT NULL,
  "kind"      TEXT NOT NULL,
  "challenge" TEXT NOT NULL,
  "userId"    TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebAuthnChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebAuthnChallenge_challenge_key"
  ON "WebAuthnChallenge"("challenge");
CREATE INDEX "WebAuthnChallenge_expiresAt_idx"
  ON "WebAuthnChallenge"("expiresAt");
CREATE INDEX "WebAuthnChallenge_userId_idx"
  ON "WebAuthnChallenge"("userId");
