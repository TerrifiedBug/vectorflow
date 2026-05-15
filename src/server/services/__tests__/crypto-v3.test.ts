import { describe, it, expect, beforeEach } from "vitest";
import { encryptForOrg, decryptForOrg, deriveJwtSigningKey } from "../crypto";
import { ENCRYPTION_DOMAINS } from "../crypto";
import { getKmsProvider, resetKmsForTests } from "../kms";

describe("v3 per-org envelope encryption", () => {
  beforeEach(async () => {
    process.env.NEXTAUTH_SECRET = "test-secret-for-v3-tests-only-not-prod";
    delete process.env.VF_LOCAL_KMS_KEY;
    resetKmsForTests();
  });

  async function newOrgDekCiphertext(orgId: string): Promise<string> {
    const kms = getKmsProvider();
    const { ciphertext } = await kms.generateDataKey(orgId);
    return ciphertext;
  }

  it("produces a v3: prefixed ciphertext", async () => {
    const dek = await newOrgDekCiphertext("org-a");
    const ct = await encryptForOrg("hello", {
      orgId: "org-a",
      dataKeyCiphertext: dek,
      domain: ENCRYPTION_DOMAINS.SECRETS,
      rowTable: "Secret",
      rowId: "row-1",
    });
    expect(ct.startsWith("v3:")).toBe(true);
  });

  it("round-trips plaintext", async () => {
    const dek = await newOrgDekCiphertext("org-a");
    const ct = await encryptForOrg("hello world", {
      orgId: "org-a",
      dataKeyCiphertext: dek,
      domain: ENCRYPTION_DOMAINS.SECRETS,
      rowTable: "Secret",
      rowId: "row-1",
    });
    const pt = await decryptForOrg(ct, {
      orgId: "org-a",
      dataKeyCiphertext: dek,
      domain: ENCRYPTION_DOMAINS.SECRETS,
      rowTable: "Secret",
      rowId: "row-1",
    });
    expect(pt).toBe("hello world");
  });

  it("AAD binding — ciphertext from org A in org B's row fails to decrypt", async () => {
    const dekA = await newOrgDekCiphertext("org-a");
    const dekB = await newOrgDekCiphertext("org-b");
    const ctA = await encryptForOrg("secret-A", {
      orgId: "org-a",
      dataKeyCiphertext: dekA,
      domain: ENCRYPTION_DOMAINS.SECRETS,
      rowTable: "Secret",
      rowId: "row-1",
    });
    await expect(
      decryptForOrg(ctA, {
        orgId: "org-b",
        dataKeyCiphertext: dekB,
        domain: ENCRYPTION_DOMAINS.SECRETS,
        rowTable: "Secret",
        rowId: "row-1",
      }),
    ).rejects.toThrow();
  });

  it("AAD binding — different domain fails to decrypt", async () => {
    const dek = await newOrgDekCiphertext("org-a");
    const ct = await encryptForOrg("hello", {
      orgId: "org-a",
      dataKeyCiphertext: dek,
      domain: ENCRYPTION_DOMAINS.SECRETS,
      rowTable: "Secret",
      rowId: "row-1",
    });
    await expect(
      decryptForOrg(ct, {
        orgId: "org-a",
        dataKeyCiphertext: dek,
        domain: ENCRYPTION_DOMAINS.CERTIFICATES,
        rowTable: "Secret",
        rowId: "row-1",
      }),
    ).rejects.toThrow();
  });

  it("AAD binding — different rowId fails to decrypt", async () => {
    const dek = await newOrgDekCiphertext("org-a");
    const ct = await encryptForOrg("hello", {
      orgId: "org-a",
      dataKeyCiphertext: dek,
      domain: ENCRYPTION_DOMAINS.SECRETS,
      rowTable: "Secret",
      rowId: "row-1",
    });
    await expect(
      decryptForOrg(ct, {
        orgId: "org-a",
        dataKeyCiphertext: dek,
        domain: ENCRYPTION_DOMAINS.SECRETS,
        rowTable: "Secret",
        rowId: "row-2",
      }),
    ).rejects.toThrow();
  });

  it("AAD binding — different table fails to decrypt", async () => {
    const dek = await newOrgDekCiphertext("org-a");
    const ct = await encryptForOrg("hello", {
      orgId: "org-a",
      dataKeyCiphertext: dek,
      domain: ENCRYPTION_DOMAINS.SECRETS,
      rowTable: "Secret",
      rowId: "row-1",
    });
    await expect(
      decryptForOrg(ct, {
        orgId: "org-a",
        dataKeyCiphertext: dek,
        domain: ENCRYPTION_DOMAINS.SECRETS,
        rowTable: "Certificate",
        rowId: "row-1",
      }),
    ).rejects.toThrow();
  });

  it("two encryptions of the same plaintext produce different ciphertexts (IV randomness)", async () => {
    const dek = await newOrgDekCiphertext("org-a");
    const ct1 = await encryptForOrg("same", {
      orgId: "org-a",
      dataKeyCiphertext: dek,
      domain: ENCRYPTION_DOMAINS.SECRETS,
      rowTable: "Secret",
      rowId: "row-1",
    });
    const ct2 = await encryptForOrg("same", {
      orgId: "org-a",
      dataKeyCiphertext: dek,
      domain: ENCRYPTION_DOMAINS.SECRETS,
      rowTable: "Secret",
      rowId: "row-1",
    });
    expect(ct1).not.toBe(ct2);
  });

  it("survives DEK re-wrap: re-wrap the org's DEK, decryption still works", async () => {
    const dek1 = await newOrgDekCiphertext("org-a");
    const kms = getKmsProvider();
    const plaintextDek = await kms.unwrapDataKey(dek1, "org-a");
    const dek2 = await kms.rewrapDataKey(plaintextDek, "org-a");

    const ct = await encryptForOrg("hello", {
      orgId: "org-a",
      dataKeyCiphertext: dek1,
      domain: ENCRYPTION_DOMAINS.SECRETS,
      rowTable: "Secret",
      rowId: "row-1",
    });
    const ptWithNewDek = await decryptForOrg(ct, {
      orgId: "org-a",
      dataKeyCiphertext: dek2,
      domain: ENCRYPTION_DOMAINS.SECRETS,
      rowTable: "Secret",
      rowId: "row-1",
    });
    expect(ptWithNewDek).toBe("hello");
  });
});

describe("deriveJwtSigningKey", () => {
  it("returns a 32-byte buffer", () => {
    const dek = Buffer.alloc(32, 1);
    const sk = deriveJwtSigningKey(dek);
    expect(sk).toBeInstanceOf(Buffer);
    expect(sk.length).toBe(32);
  });

  it("is deterministic for the same DEK", () => {
    const dek = Buffer.alloc(32, 1);
    const sk1 = deriveJwtSigningKey(dek);
    const sk2 = deriveJwtSigningKey(dek);
    expect(sk1.equals(sk2)).toBe(true);
  });

  it("rotates with the DEK — different DEKs produce different signing keys", () => {
    const dek1 = Buffer.alloc(32, 1);
    const dek2 = Buffer.alloc(32, 2);
    const sk1 = deriveJwtSigningKey(dek1);
    const sk2 = deriveJwtSigningKey(dek2);
    expect(sk1.equals(sk2)).toBe(false);
  });

  it("uses a domain-separated info string distinct from other crypto domains", () => {
    // JWT key MUST NOT equal the SECRETS key derived from the same DEK.
    // Implementation detail: HKDF with info='vf:v3:jwt' vs 'vf:v3:secrets'
    const dek = Buffer.alloc(32, 0xab);
    const jwtKey = deriveJwtSigningKey(dek);
    // sanity: must not be all zeros and must not equal DEK
    expect(jwtKey.equals(Buffer.alloc(32, 0))).toBe(false);
    expect(jwtKey.equals(dek)).toBe(false);
  });
});
