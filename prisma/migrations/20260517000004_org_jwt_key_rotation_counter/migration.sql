-- Per-org JWT signing key rotation counter.
--
-- Per-org JWT signing keys derive from the org's DEK via HKDF; the
-- rotation counter is mixed into the HKDF `info` parameter so an
-- owner-triggered "revoke all sessions" bumps the counter and produces
-- a NEW signing key without touching the underlying DEK. Existing JWTs
-- fail signature verification immediately on the next request.
--
-- The counter starts at 0 and only ever increases. Past values are not
-- retained — once rotated, the previous key is unrecoverable. NextAuth
-- accepts an array of secrets (newest → oldest) so the per-org auth
-- instance can hold a short grace window if needed; the canonical
-- behaviour is single-secret (revocation is intentional, no grace).
--
-- Rollback:
--   ALTER TABLE "Organization" DROP COLUMN "jwtKeyRotationCounter";

ALTER TABLE "Organization"
  ADD COLUMN "jwtKeyRotationCounter" INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN "Organization"."jwtKeyRotationCounter" IS
  'Incremented to revoke every active session for this org. Mixed into HKDF info of deriveJwtSigningKey so the resulting signing key changes when the counter changes.';
