#!/usr/bin/env node
/**
 * mint-test-session.mjs — emit the VF <-> CHAD session contract fixture.
 *
 * Mints a real Auth.js (NextAuth v5) session cookie with the SAME
 * primitives production uses — `encode()` from next-auth/jwt: HKDF-SHA256
 * key derivation salted by the cookie name, then JWE dir/A256CBC-HS512 —
 * using a fixed TEST-ONLY secret, and prints the contract fixture JSON
 * to stdout:
 *
 *   { cookie_name, cookie_value, secret, expected_claims }
 *
 * The output is committed in the CHAD repo at
 * backend/tests/fixtures/vf-session-fixture.json and decoded by CHAD's
 * backend/app/core/vf_session.py contract test (python-jose jose.jwe).
 *
 * Usage:
 *   node scripts/mint-test-session.mjs > vf-session-fixture.json
 */
import { encode, decode } from "next-auth/jwt";

// TEST-ONLY secret, shared with the committed fixture. Never a real
// deployment secret — real deployments use NEXTAUTH_SECRET / per-org keys.
const SECRET = "vf-suite-contract-test-secret";
const COOKIE_NAME = "authjs.session-token";
// Committed-fixture lifetime: 10 years so the CHAD contract test never
// rots. Production sessions use the 24h maxAge from authConfig.session /
// SESSION_MAX_AGE_S; the CHAD decoder's expiry handling is exercised by
// its own expired-token unit test, not by this fixture.
const FIXTURE_MAX_AGE_S = 60 * 60 * 24 * 365 * 10;

const claims = {
  id: "vf-contract-user-1",
  sub: "vf-contract-user-1",
  name: "Suite Contract User",
  email: "suite-contract@vectorflow.test",
  picture: null,
  provider: "credentials",
  org_id: "default",
  authedAt: Date.now(),
  suite_role: "admin",
};

const cookieValue = await encode({
  salt: COOKIE_NAME,
  secret: SECRET,
  maxAge: FIXTURE_MAX_AGE_S,
  token: claims,
});

// Round-trip through decode() so expected_claims.exp is the REAL exp
// Auth.js stamped, not a re-computed approximation.
const decoded = await decode({
  salt: COOKIE_NAME,
  secret: SECRET,
  token: cookieValue,
});
if (!decoded || decoded.suite_role !== "admin" || decoded.org_id !== "default") {
  console.error("mint-test-session: self-check failed — decoded claims do not match minted claims");
  process.exit(1);
}

const fixture = {
  cookie_name: COOKIE_NAME,
  cookie_value: cookieValue,
  secret: SECRET,
  expected_claims: {
    user_id: claims.id,
    email: claims.email,
    name: claims.name,
    suite_role: claims.suite_role,
    org_id: claims.org_id,
    provider: claims.provider,
    authed_at: claims.authedAt,
    exp: decoded.exp,
  },
};

process.stdout.write(JSON.stringify(fixture, null, 2) + "\n");
