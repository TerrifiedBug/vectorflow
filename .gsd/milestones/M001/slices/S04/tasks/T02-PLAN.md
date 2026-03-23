---
estimated_steps: 3
estimated_files: 3
skills_used:
  - test
---

# T02: Write auth and utility pure-function tests (totp, crypto, pipeline-status)

**Slice:** S04 — Foundational Test Suite
**Milestone:** M001

## Description

Write tests for the remaining pure-function modules: TOTP operations (auth domain), encrypt/decrypt (auth domain), and pipeline status derivation (shared utilities). All three modules are pure functions with no Prisma dependency — they can be tested directly without mocking.

This task covers the "auth flows" requirement from R002 at the unit level: TOTP secret generation, code verification (valid/expired/wrong), backup codes (generate, hash, verify with consume-on-use semantics), and encrypt/decrypt round-trips.

## Steps

1. Create `src/server/services/__tests__/totp.test.ts`:
   - Test `generateTotpSecret(email)` — returns `{ secret, uri }`, URI contains the email and issuer "VectorFlow"
   - Test `verifyTotpCode(secret, code)` — generate a valid code using the `otpauth` library (same as app uses: `import { TOTP, Secret } from "otpauth"`), verify it returns true
   - Test `verifyTotpCode` with wrong code — returns false
   - Test `generateBackupCodes()` — returns an array of strings, each is 8+ chars
   - Test `hashBackupCode(code)` — returns a hex string, deterministic (same input → same hash)
   - Test `verifyBackupCode(plainCode, hashedCodes)` — returns the matching hash when found, null when not found. The function signature is `verifyBackupCode(plain: string, hashes: string[]): string | null` — it returns the matched hash so the caller can remove it (consume-on-use)

2. Create `src/server/services/__tests__/crypto.test.ts`:
   - Set `process.env.NEXTAUTH_SECRET = 'test-secret-for-vitest'` at the top of the test file (before imports if needed, or in a `beforeAll`)
   - Test encrypt/decrypt round-trip — `decrypt(encrypt(plaintext))` equals original plaintext
   - Test with various inputs: empty string, long string, unicode characters
   - Test that different plaintexts produce different ciphertexts (randomized IV)
   - Test decrypt with corrupted ciphertext throws an error

3. Create `src/lib/__tests__/pipeline-status.test.ts`:
   - Test `aggregateProcessStatus` with: empty array → null, all RUNNING → RUNNING, mixed with CRASHED → CRASHED, mixed with STOPPED → STOPPED, STARTING priority, PENDING priority
   - Test `derivePipelineStatus` with: empty nodes → PENDING, any CRASHED → CRASHED, any RUNNING → RUNNING, all STOPPED → STOPPED, fallback to first node's status

## Must-Haves

- [ ] TOTP tests cover generation, verification (valid + invalid), and backup codes
- [ ] Crypto tests cover encrypt/decrypt round-trip with `NEXTAUTH_SECRET` set
- [ ] Pipeline-status tests cover both `aggregateProcessStatus` and `derivePipelineStatus` with edge cases
- [ ] All tests pass with `pnpm test`

## Verification

- `pnpm exec vitest run --reporter=verbose` exits 0 with all 4 test files passing (3 new + 1 from T01)
- `test -f src/server/services/__tests__/totp.test.ts`
- `test -f src/server/services/__tests__/crypto.test.ts`
- `test -f src/lib/__tests__/pipeline-status.test.ts`

## Inputs

- `src/server/services/totp.ts` — exports `generateTotpSecret`, `verifyTotpCode`, `generateBackupCodes`, `hashBackupCode`, `verifyBackupCode`; uses `otpauth` library (TOTP, Secret); constants: ISSUER="VectorFlow", DIGITS=6, PERIOD=30, ALGORITHM="SHA1"
- `src/server/services/crypto.ts` — exports `encrypt(plaintext: string): string`, `decrypt(ciphertext: string): string`; derives key from `process.env.NEXTAUTH_SECRET` via SHA-256; uses AES-256-GCM with random IV
- `src/lib/pipeline-status.ts` — exports `aggregateProcessStatus(statuses: Array<{status: string}>)` returns status or null; `derivePipelineStatus(nodes: Array<{pipelineStatus: string}>)` returns status string
- `vitest.config.ts` — created in T01, provides `@/` alias
- `src/__mocks__/lib/prisma.ts` — created in T01 (not used by this task but available)

## Expected Output

- `src/server/services/__tests__/totp.test.ts` — new test file for TOTP auth functions
- `src/server/services/__tests__/crypto.test.ts` — new test file for encryption functions
- `src/lib/__tests__/pipeline-status.test.ts` — new test file for shared pipeline status utilities
