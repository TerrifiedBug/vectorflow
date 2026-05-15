import { describe, it, expect, beforeEach } from "vitest";
import { LocalDevKmsProvider } from "../local-dev";

describe("LocalDevKmsProvider", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "test-secret-for-local-dev-kms-only-not-prod";
    delete process.env.VF_LOCAL_KMS_KEY;
  });

  it("generateDataKey returns 32-byte plaintext and an opaque ciphertext", async () => {
    const kms = new LocalDevKmsProvider();
    const { plaintext, ciphertext } = await kms.generateDataKey("org-a");

    expect(plaintext).toBeInstanceOf(Buffer);
    expect(plaintext.length).toBe(32);
    expect(typeof ciphertext).toBe("string");
    expect(ciphertext.length).toBeGreaterThan(0);
    // Ciphertext must not be the raw plaintext
    expect(ciphertext).not.toContain(plaintext.toString("base64"));
  });

  it("unwrapDataKey returns the original plaintext", async () => {
    const kms = new LocalDevKmsProvider();
    const { plaintext, ciphertext } = await kms.generateDataKey("org-a");
    const unwrapped = await kms.unwrapDataKey(ciphertext, "org-a");
    expect(unwrapped.equals(plaintext)).toBe(true);
  });

  it("unwrap binds ciphertext to orgId (AAD-style): wrong org rejected", async () => {
    const kms = new LocalDevKmsProvider();
    const { ciphertext } = await kms.generateDataKey("org-a");
    await expect(kms.unwrapDataKey(ciphertext, "org-b")).rejects.toThrow();
  });

  it("rewrapDataKey produces a fresh ciphertext that unwraps to the same plaintext", async () => {
    const kms = new LocalDevKmsProvider();
    const { plaintext, ciphertext: c1 } = await kms.generateDataKey("org-a");
    const c2 = await kms.rewrapDataKey(plaintext, "org-a");
    expect(c2).not.toBe(c1);
    const u1 = await kms.unwrapDataKey(c1, "org-a");
    const u2 = await kms.unwrapDataKey(c2, "org-a");
    expect(u1.equals(plaintext)).toBe(true);
    expect(u2.equals(plaintext)).toBe(true);
  });

  it("describeKey returns local-dev provider identification", () => {
    const kms = new LocalDevKmsProvider();
    const d = kms.describeKey();
    expect(d.provider).toBe("local-dev");
    expect(typeof d.keyId).toBe("string");
    expect(d.keyId.length).toBeGreaterThan(0);
  });

  it("two providers built from the same KEK can unwrap each other's ciphertexts", async () => {
    const k1 = new LocalDevKmsProvider();
    const { plaintext, ciphertext } = await k1.generateDataKey("org-a");
    const k2 = new LocalDevKmsProvider();
    const unwrapped = await k2.unwrapDataKey(ciphertext, "org-a");
    expect(unwrapped.equals(plaintext)).toBe(true);
  });

  it("rotating VF_LOCAL_KMS_KEY makes old ciphertexts undecryptable", async () => {
    const k1 = new LocalDevKmsProvider();
    const { ciphertext } = await k1.generateDataKey("org-a");

    process.env.VF_LOCAL_KMS_KEY = "rotated-master-key-for-test";
    const k2 = new LocalDevKmsProvider();
    await expect(k2.unwrapDataKey(ciphertext, "org-a")).rejects.toThrow();
  });
});
