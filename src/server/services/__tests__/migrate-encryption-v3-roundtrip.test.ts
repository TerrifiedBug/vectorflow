/**
 * Migration ↔ runtime AAD-agreement round-trip tests.
 *
 * These tests pin the contract that the v2→v3 migration script
 * (`scripts/migrate-encryption-v3.ts`) MUST write each column's v3
 * ciphertext with the exact same `(domain, rowTable, rowId)` AAD that the
 * runtime readers use to decrypt it. A mismatch makes migrated ciphertext
 * permanently undecryptable (see security audit VF-06 / VF-07 / VF-19).
 *
 * The flow mirrors production:
 *   1. Write a v2 ciphertext the way the runtime app does (`encrypt`,
 *      GENERIC domain — the production default at every callsite).
 *   2. Re-encrypt it as v3 with the SAME ctx the migration script passes
 *      to `migrateValue` (this is the writer under test).
 *   3. Decrypt the migrated v3 with `decryptForOrgOrFallback` using the
 *      EXACT ctx each runtime reader passes (the reader under test).
 *   4. Assert the plaintext survives.
 *
 * Each ctx below is copied from the real callsite — keep them in sync if
 * the runtime AAD ever changes.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { migrateValue, type MigrationRowContext } from "../migrate-encryption-v3";
import { ENCRYPTION_DOMAINS, encrypt } from "../crypto";
import {
  decryptForOrgOrFallback,
  type CallsiteCryptoContext,
} from "../crypto-v3-callsite";
import { getKmsProvider, resetKmsForTests } from "../kms";

const ORG_ID = "org-roundtrip-test";

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "roundtrip-test-secret-not-prod-32chars";
  delete process.env.VF_ENCRYPTION_KEY_V2;
  delete process.env.VF_LOCAL_KMS_KEY;
  resetKmsForTests();
});

async function newDek(orgId: string): Promise<string> {
  const { ciphertext } = await getKmsProvider().generateDataKey(orgId);
  return ciphertext;
}

/**
 * Encrypt-as-migration then decrypt-as-runtime, asserting the plaintext
 * survives. `migrationCtx` is what the migration script writes;
 * `readerCtx` is what the runtime reader passes — they MUST agree.
 */
async function assertRoundTrip(
  plaintext: string,
  migrationCtx: MigrationRowContext,
  readerCtx: CallsiteCryptoContext,
): Promise<void> {
  // Step 1: a v2 ciphertext written by the runtime app (always GENERIC).
  const v2 = encrypt(plaintext, ENCRYPTION_DOMAINS.GENERIC);

  // Step 2: migration re-encrypts v2 → v3 (writer under test).
  const migrated = await migrateValue(v2, migrationCtx);
  expect(migrated.status).toBe("migrated");
  expect(migrated.ciphertext?.startsWith("v3:")).toBe(true);

  // Step 3: runtime reader decrypts the migrated v3 (reader under test).
  const out = await decryptForOrgOrFallback(migrated.ciphertext!, readerCtx);
  expect(out).toBe(plaintext);
}

describe("migration ↔ runtime AAD agreement", () => {
  it("VF-06: Secret round-trips (migration writer ↔ secret-resolver reader)", async () => {
    const dek = await newDek(ORG_ID);
    const environmentId = "env-1";
    const name = "DB_PASSWORD";
    await assertRoundTrip(
      "super-secret-value",
      // scripts/migrate-encryption-v3.ts — Secret block
      {
        orgId: ORG_ID,
        dataKeyCiphertext: dek,
        domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: "Secret",
        rowId: `${environmentId}:${name}`,
      },
      // src/server/services/secret-resolver.ts / secret.ts / agent config
      {
        orgId: ORG_ID,
        dataKeyCiphertext: dek,
        domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: "Secret",
        rowId: `${environmentId}:${name}`,
      },
    );
  });

  it("VF-07: Environment.gitToken round-trips (migration writer ↔ git-sync reader)", async () => {
    const dek = await newDek(ORG_ID);
    const envId = "env-1";
    await assertRoundTrip(
      "ghp_exampletoken",
      // scripts/migrate-encryption-v3.ts — gitToken
      {
        orgId: ORG_ID,
        dataKeyCiphertext: dek,
        domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: "Environment",
        rowId: envId,
      },
      // src/server/services/git-sync.ts / gitops-promotion.ts / environment.ts
      {
        orgId: ORG_ID,
        dataKeyCiphertext: dek,
        domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: "Environment",
        rowId: envId,
      },
    );
  });

  it("VF-19: Environment.gitWebhookSecret round-trips (migration writer ↔ webhook reader)", async () => {
    const dek = await newDek(ORG_ID);
    const envId = "env-1";
    await assertRoundTrip(
      "webhook-signing-secret",
      // scripts/migrate-encryption-v3.ts — gitWebhookSecret
      {
        orgId: ORG_ID,
        dataKeyCiphertext: dek,
        domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: "Environment",
        rowId: envId,
      },
      // src/app/api/webhooks/git/route.ts
      {
        orgId: ORG_ID,
        dataKeyCiphertext: dek,
        domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: "Environment",
        rowId: envId,
      },
    );
  });

  it("regression guard: a domain mismatch (SECRETS writer vs GENERIC reader) fails to decrypt", async () => {
    const dek = await newDek(ORG_ID);
    const v2 = encrypt("x", ENCRYPTION_DOMAINS.SECRETS);
    const migrated = await migrateValue(v2, {
      orgId: ORG_ID,
      dataKeyCiphertext: dek,
      domain: ENCRYPTION_DOMAINS.SECRETS,
      rowTable: "Secret",
      rowId: "env-1:DB_PASSWORD",
    });
    expect(migrated.status).toBe("migrated");
    await expect(
      decryptForOrgOrFallback(migrated.ciphertext!, {
        orgId: ORG_ID,
        dataKeyCiphertext: dek,
        domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: "Secret",
        rowId: "env-1:DB_PASSWORD",
      }),
    ).rejects.toThrow();
  });

  it("regression guard: a rowId mismatch (cuid writer vs composite reader) fails to decrypt", async () => {
    const dek = await newDek(ORG_ID);
    const v2 = encrypt("x", ENCRYPTION_DOMAINS.GENERIC);
    const migrated = await migrateValue(v2, {
      orgId: ORG_ID,
      dataKeyCiphertext: dek,
      domain: ENCRYPTION_DOMAINS.GENERIC,
      rowTable: "Secret",
      rowId: "clxyz-cuid", // the OLD buggy migration rowId
    });
    expect(migrated.status).toBe("migrated");
    await expect(
      decryptForOrgOrFallback(migrated.ciphertext!, {
        orgId: ORG_ID,
        dataKeyCiphertext: dek,
        domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: "Secret",
        rowId: "env-1:DB_PASSWORD", // the runtime reader rowId
      }),
    ).rejects.toThrow();
  });
});
