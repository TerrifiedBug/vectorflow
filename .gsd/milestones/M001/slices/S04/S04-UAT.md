# S04: Foundational Test Suite — UAT Script

## Preconditions

- Working directory: project root of VectorFlow
- Node.js and pnpm installed
- Dependencies installed (`pnpm install` completed)
- S01 and S02 completed (shared utilities and service modules exist)

---

## TC-01: Full Test Suite Passes

**Steps:**
1. Run `pnpm test`
2. Observe exit code and output

**Expected:**
- Exit code 0
- 105 tests pass across 7 test files
- No failures, no skipped tests
- Duration under 5 seconds

---

## TC-02: Verbose Output Shows All Domains

**Steps:**
1. Run `pnpm exec vitest run --reporter=verbose`
2. Scan output for test file names and describe blocks

**Expected:**
- `dashboard-data.test.ts` — "computeChartMetrics" with groupBy pipeline/node/aggregate, downsampling, bigint, latency tests
- `totp.test.ts` — "generateTotpSecret", "verifyTotpCode", "generateBackupCodes", "hashBackupCode", "verifyBackupCode"
- `crypto.test.ts` — "encrypt and decrypt", "encryption randomization", "decrypt error handling", "missing NEXTAUTH_SECRET"
- `pipeline-status.test.ts` — "aggregateProcessStatus", "derivePipelineStatus"
- `alert-evaluator.test.ts` — "evaluateAlerts" with firing, resolving, dedup, binary metrics, duration
- `pipeline-graph.test.ts` — "detectConfigChanges", "saveGraphComponents", "listPipelinesForEnvironment"
- `deploy-agent.test.ts` — "deployAgent", "undeployAgent"

---

## TC-03: Individual Test File Isolation

**Steps:**
1. Run `pnpm exec vitest run -- alert-evaluator`
2. Run `pnpm exec vitest run -- deploy-agent`
3. Run `pnpm exec vitest run -- pipeline-graph`

**Expected:**
- Each command runs only the targeted test file
- Each passes independently (no cross-file dependency)
- Prisma mock resets between tests (no stale state leaks)

---

## TC-04: TypeScript Compliance Preserved (R001)

**Steps:**
1. Run `pnpm exec tsc --noEmit`

**Expected:**
- Exit code 0
- No type errors from test files or production code
- Specifically: no bigint literal errors (tests use `BigInt()` constructor)

---

## TC-05: ESLint Compliance Preserved (R008)

**Steps:**
1. Run `pnpm exec eslint src/`

**Expected:**
- Exit code 0
- No lint errors or warnings from test files

---

## TC-06: Test Infrastructure Files Exist

**Steps:**
1. Verify `vitest.config.ts` exists at project root
2. Verify `src/__mocks__/lib/prisma.ts` exists
3. Verify `package.json` contains `"test": "vitest run"` in scripts
4. Verify `package.json` devDependencies include `vitest` and `vitest-mock-extended`

**Expected:**
- All four files/entries exist
- `vitest.config.ts` has `@/` → `./src/` path alias
- Mock helper file contains documentation of the inline mock pattern

---

## TC-07: Auth Domain — TOTP Edge Cases

**Steps:**
1. Run `pnpm exec vitest run -- totp`
2. Inspect test output for backup code tests

**Expected:**
- `verifyBackupCode` returns `{ valid: boolean; remaining: string[] }` — not string/null
- Case-insensitive matching works (lowercase input matches uppercase-hashed code)
- Original hashes array is not mutated (immutability)
- Duplicate hashes: only the first match is removed

---

## TC-08: Auth Domain — Crypto Error Handling

**Steps:**
1. Run `pnpm exec vitest run -- crypto`
2. Inspect test output for error cases

**Expected:**
- Corrupted ciphertext throws on decrypt
- Invalid base64 throws on decrypt
- Truncated ciphertext throws on decrypt
- Missing `NEXTAUTH_SECRET` throws on both encrypt and decrypt
- Same plaintext encrypted twice produces different ciphertexts (random IV)

---

## TC-09: Alert Domain — Duration Tracking

**Steps:**
1. Run `pnpm exec vitest run -- alert-evaluator`
2. Inspect duration tracking tests

**Expected:**
- First evaluation with condition met sets timer but does NOT fire (durationSeconds > 0)
- Second evaluation after elapsed duration fires the alert
- Condition dropping and re-triggering resets the timer (not cumulative)
- Binary metrics (node_unreachable, pipeline_crashed) fire immediately with durationSeconds=0

---

## TC-10: Pipeline CRUD Domain — TRPCError Paths

**Steps:**
1. Run `pnpm exec vitest run -- pipeline-graph`
2. Inspect error path tests

**Expected:**
- `saveGraphComponents` with non-existent pipeline throws TRPCError with code `NOT_FOUND`
- `saveGraphComponents` with missing shared component throws TRPCError with code `BAD_REQUEST`
- `detectConfigChanges` when `generateVectorYaml` throws returns `false` (graceful fallback)

---

## TC-11: Deploy Domain — Error and Success Paths

**Steps:**
1. Run `pnpm exec vitest run -- deploy-agent`
2. Inspect error and success path tests

**Expected:**
- `deployAgent` with non-existent pipeline throws TRPCError `NOT_FOUND`
- `deployAgent` with invalid config returns validation errors (does not throw)
- Successful deploy creates version, pushes config to matching nodes
- System pipelines trigger system vector start (not node push)
- `undeployAgent` marks pipeline as draft

---

## TC-12: CI Failure Mode

**Steps:**
1. Temporarily break a test assertion (e.g., change an expected value in `totp.test.ts`)
2. Run `pnpm test`
3. Observe exit code
4. Revert the change

**Expected:**
- Exit code non-zero (1)
- Vitest outputs assertion diff showing expected vs received values with source location
- Only the broken test fails; other tests in the same file still run
- After revert, `pnpm test` passes again

---

## Edge Cases

### EC-01: Empty/Null Inputs
- `computeChartMetrics` with empty rows → no crash, empty output
- `aggregateProcessStatus` with empty array → returns null
- `derivePipelineStatus` with empty nodes → returns "PENDING"
- `evaluateAlerts` with null metric values → returns empty, no events created

### EC-02: BigInt Handling
- All dashboard-data tests use `BigInt()` constructor (not `0n`)
- Large values near `Number.MAX_SAFE_INTEGER` handled correctly
- Memory fields in node rows handle bigint conversion

### EC-03: Mock State Isolation
- Running tests in any order produces the same results
- `mockReset(prismaMock)` in `beforeEach` prevents state leaks
- `vi.useFakeTimers()` properly restored via `vi.useRealTimers()` in `afterEach`
