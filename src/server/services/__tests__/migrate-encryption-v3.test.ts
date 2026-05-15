import { describe, it, expect, beforeEach } from "vitest";
import {
  ensureOrgDataKey,
  migrateValue,
  newCounters,
  tally,
} from "../migrate-encryption-v3";
import {
  ENCRYPTION_DOMAINS,
  encrypt,
  decryptForOrg,
  encryptForOrg,
} from "../crypto";
import { getKmsProvider, resetKmsForTests } from "../kms";

describe("migrate-encryption-v3", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "migration-test-secret-not-prod";
    delete process.env.VF_ENCRYPTION_KEY_V2;
    delete process.env.VF_LOCAL_KMS_KEY;
    resetKmsForTests();
  });

  it("ensureOrgDataKey generates a wrapped DEK when missing", async () => {
    const r = await ensureOrgDataKey({ id: "org-a", dataKeyCiphertext: null });
    expect(r.changed).toBe(true);
    expect(r.dataKeyCiphertext.length).toBeGreaterThan(0);
  });

  it("ensureOrgDataKey is a no-op when already set", async () => {
    const r = await ensureOrgDataKey({
      id: "org-a",
      dataKeyCiphertext: "lk1:already-set",
    });
    expect(r.changed).toBe(false);
    expect(r.dataKeyCiphertext).toBe("lk1:already-set");
  });

  it("migrateValue returns skipped-empty for null/empty", async () => {
    const ctx = await testCtx("org-a", "row-1");
    expect((await migrateValue(null, ctx)).status).toBe("skipped-empty");
    expect((await migrateValue(undefined, ctx)).status).toBe("skipped-empty");
    expect((await migrateValue("", ctx)).status).toBe("skipped-empty");
  });

  it("migrateValue returns skipped-v3 for already-v3 values (idempotency)", async () => {
    const ctx = await testCtx("org-a", "row-1");
    const v3 = await encryptForOrg("payload", ctx);
    const r = await migrateValue(v3, ctx);
    expect(r.status).toBe("skipped-v3");
  });

  it("migrateValue migrates v2 → v3 and the new ciphertext round-trips", async () => {
    const ctx = await testCtx("org-a", "row-1");
    const v2 = encrypt("hello", ENCRYPTION_DOMAINS.SECRETS);
    const r = await migrateValue(v2, ctx);
    expect(r.status).toBe("migrated");
    expect(r.ciphertext?.startsWith("v3:")).toBe(true);
    const plaintext = await decryptForOrg(r.ciphertext!, ctx);
    expect(plaintext).toBe("hello");
  });

  it("migrateValue is idempotent — second pass over migrated row is skipped-v3", async () => {
    const ctx = await testCtx("org-a", "row-1");
    const v2 = encrypt("hello", ENCRYPTION_DOMAINS.SECRETS);
    const r1 = await migrateValue(v2, ctx);
    const r2 = await migrateValue(r1.ciphertext!, ctx);
    expect(r1.status).toBe("migrated");
    expect(r2.status).toBe("skipped-v3");
  });

  it("migrateValue surfaces decrypt errors as error status", async () => {
    const ctx = await testCtx("org-a", "row-1");
    const r = await migrateValue("v2:not-a-valid-base64-payload!!", ctx);
    expect(r.status).toBe("error");
    expect(r.error?.length).toBeGreaterThan(0);
  });

  it("tally aggregates counters correctly", () => {
    const c = newCounters();
    tally(c, { status: "migrated", ciphertext: "v3:..." });
    tally(c, { status: "migrated", ciphertext: "v3:..." });
    tally(c, { status: "skipped-v3" });
    tally(c, { status: "skipped-empty" });
    tally(c, { status: "error", error: "x" });
    expect(c).toEqual({
      migrated: 2,
      skippedV3: 1,
      skippedEmpty: 1,
      errors: 1,
    });
  });
});

async function testCtx(orgId: string, rowId: string) {
  const kms = getKmsProvider();
  const { ciphertext } = await kms.generateDataKey(orgId);
  return {
    orgId,
    dataKeyCiphertext: ciphertext,
    domain: ENCRYPTION_DOMAINS.SECRETS,
    rowTable: "Secret",
    rowId,
  };
}
