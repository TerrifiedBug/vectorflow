---
id: T02
parent: S04
milestone: M001
provides:
  - 25 TOTP auth tests covering generation, verification, backup codes (hash, verify, consume-on-use)
  - 13 crypto tests covering encrypt/decrypt round-trip, randomization, error handling, missing secret
  - 19 pipeline-status tests covering aggregateProcessStatus and derivePipelineStatus with edge cases
key_files:
  - src/server/services/__tests__/totp.test.ts
  - src/server/services/__tests__/crypto.test.ts
  - src/lib/__tests__/pipeline-status.test.ts
key_decisions:
  - Adapted verifyBackupCode tests to actual return type { valid: boolean; remaining: string[] } instead of string | null documented in the plan
patterns_established:
  - Environment variable isolation pattern in crypto tests: save/restore process.env in beforeAll/afterAll with finally blocks for per-test env mutations
observability_surfaces:
  - pnpm exec vitest run --reporter=verbose — shows per-test pass/fail across all 4 test files (72 total tests)
  - pnpm exec vitest run --reporter=verbose -- totp — runs only TOTP tests
  - pnpm exec vitest run --reporter=verbose -- crypto — runs only crypto tests
  - pnpm exec vitest run --reporter=verbose -- pipeline-status — runs only pipeline-status tests
duration: 6m
verification_result: passed
completed_at: 2026-03-23
blocker_discovered: false
---

# T02: Write auth and utility pure-function tests (totp, crypto, pipeline-status)

**Added 57 pure-function tests covering TOTP auth (generation, verification, backup codes), AES-256-GCM encrypt/decrypt, and pipeline status derivation across 3 new test files**

## What Happened

Created three test files for the remaining pure-function modules that have no Prisma dependency.

**`totp.test.ts` (25 tests):** Tests `generateTotpSecret` (returns secret + otpauth URI with correct email/issuer/format, generates unique secrets), `verifyTotpCode` (valid current code via `otpauth` library, rejects wrong/non-numeric/empty codes), `generateBackupCodes` (10 codes, 8 chars each, uppercase hex, unique), `hashBackupCode` (SHA-256 hex, deterministic, case-insensitive via uppercase normalization), and `verifyBackupCode` (returns `{ valid, remaining }` with matched hash removed, case-insensitive matching, immutability of input array, empty array edge case, duplicate hash handling).

**`crypto.test.ts` (13 tests):** Sets `NEXTAUTH_SECRET` via `beforeAll`/`afterAll` with proper cleanup. Tests encrypt/decrypt round-trip with simple text, empty string, 10K-char string, unicode, and JSON. Verifies base64 output format, IV randomization (same plaintext → different ciphertext), and error handling for corrupted, invalid, and truncated ciphertext. Also tests that both `encrypt` and `decrypt` throw with descriptive error when `NEXTAUTH_SECRET` is unset.

**`pipeline-status.test.ts` (19 tests):** Tests `aggregateProcessStatus` with empty array → null, all RUNNING, CRASHED priority, STOPPED priority, STARTING priority, PENDING priority, single-status edge cases, and full priority chain verification. Tests `derivePipelineStatus` with empty → PENDING, CRASHED/RUNNING/STARTING priority, all-STOPPED, fallback to first node status, and single-node edge cases.

## Verification

- `pnpm exec vitest run --reporter=verbose` — 72/72 tests pass across 4 test files (15 from T01 + 57 new), exit 0
- `pnpm exec tsc --noEmit` — exit 0, no type errors
- `pnpm exec eslint src/` — exit 0, no lint errors
- All 3 new test files exist at expected paths

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm exec vitest run --reporter=verbose` | 0 | ✅ pass | 0.4s |
| 2 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | 8.0s |
| 3 | `pnpm exec eslint src/` | 0 | ✅ pass | 8.0s |
| 4 | `test -f src/server/services/__tests__/totp.test.ts` | 0 | ✅ pass | <1s |
| 5 | `test -f src/server/services/__tests__/crypto.test.ts` | 0 | ✅ pass | <1s |
| 6 | `test -f src/lib/__tests__/pipeline-status.test.ts` | 0 | ✅ pass | <1s |

## Diagnostics

- Run `pnpm exec vitest run --reporter=verbose` to see all test results with durations
- Run `pnpm exec vitest run --reporter=verbose -- totp` to run only TOTP tests
- Run `pnpm exec vitest run --reporter=verbose -- crypto` to run only crypto tests
- Run `pnpm exec vitest run --reporter=verbose -- pipeline-status` to run only pipeline-status tests
- On failure, Vitest shows assertion diffs with expected/received values and exact source locations

## Deviations

- **`verifyBackupCode` return type:** The plan stated the function returns `string | null` (matched hash or null). The actual implementation returns `{ valid: boolean; remaining: string[] }` (valid flag + remaining hashes with the used code removed). Tests written against the actual implementation, covering immutability of the original array and duplicate hash handling.
- **Additional test coverage beyond plan:** Added tests for missing `NEXTAUTH_SECRET` error handling in crypto (encrypt and decrypt both throw), and case-insensitivity in backup code matching (the source uppercases input before hashing).

## Known Issues

None.

## Files Created/Modified

- `src/server/services/__tests__/totp.test.ts` — new; 25 tests for TOTP generation, verification, and backup code functions
- `src/server/services/__tests__/crypto.test.ts` — new; 13 tests for AES-256-GCM encrypt/decrypt with env var management
- `src/lib/__tests__/pipeline-status.test.ts` — new; 19 tests for aggregateProcessStatus and derivePipelineStatus
