import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";

// Set NEXTAUTH_SECRET before importing crypto module (it reads env at call time)
const ORIGINAL_SECRET = process.env.NEXTAUTH_SECRET;
const ORIGINAL_V2_KEY = process.env.VF_ENCRYPTION_KEY_V2;
beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-vitest";
  delete process.env.VF_ENCRYPTION_KEY_V2;
});
afterAll(() => {
  if (ORIGINAL_SECRET !== undefined) {
    process.env.NEXTAUTH_SECRET = ORIGINAL_SECRET;
  } else {
    delete process.env.NEXTAUTH_SECRET;
  }
  if (ORIGINAL_V2_KEY !== undefined) {
    process.env.VF_ENCRYPTION_KEY_V2 = ORIGINAL_V2_KEY;
  } else {
    delete process.env.VF_ENCRYPTION_KEY_V2;
  }
});

import { encrypt, decrypt, decryptLegacy, ENCRYPTION_DOMAINS } from "@/server/services/crypto";

// ─── encrypt/decrypt round-trip ────────────────────────────────────────────

describe("encrypt and decrypt (v2 format)", () => {
  it("round-trips a simple plaintext", () => {
    const plaintext = "hello world";
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("round-trips an empty string", () => {
    const ciphertext = encrypt("");
    expect(decrypt(ciphertext)).toBe("");
  });

  it("round-trips a long string", () => {
    const plaintext = "A".repeat(10_000);
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("round-trips unicode characters", () => {
    const plaintext = "こんにちは 🌍 éàü ñ 中文";
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("round-trips special characters and JSON", () => {
    const plaintext = JSON.stringify({ key: "value", nested: [1, 2, 3] });
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("produces v2-prefixed ciphertext", () => {
    const ciphertext = encrypt("test");
    expect(ciphertext).toMatch(/^v2:/);
  });

  it("produces base64-encoded ciphertext after the v2: prefix", () => {
    const ciphertext = encrypt("test");
    const b64 = ciphertext.slice("v2:".length);
    expect(b64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});

// ─── Randomization ─────────────────────────────────────────────────────────

describe("encryption randomization", () => {
  it("different plaintexts produce different ciphertexts", () => {
    const a = encrypt("plaintext-a");
    const b = encrypt("plaintext-b");
    expect(a).not.toBe(b);
  });

  it("same plaintext produces different ciphertexts (random IV)", () => {
    const a = encrypt("identical");
    const b = encrypt("identical");
    expect(a).not.toBe(b);
  });
});

// ─── Domain-separated keys ─────────────────────────────────────────────────

describe("domain-separated encryption", () => {
  it("different domains produce different ciphertexts for same plaintext", () => {
    const plaintext = "sensitive-value";
    const ct1 = encrypt(plaintext, ENCRYPTION_DOMAINS.SECRETS);
    const ct2 = encrypt(plaintext, ENCRYPTION_DOMAINS.CERTIFICATES);
    const ct3 = encrypt(plaintext, ENCRYPTION_DOMAINS.TOTP);
    expect(ct1).not.toBe(ct2);
    expect(ct1).not.toBe(ct3);
    expect(ct2).not.toBe(ct3);
  });

  it("decrypt with correct domain round-trips successfully", () => {
    const plaintext = "my-certificate-data";
    const ciphertext = encrypt(plaintext, ENCRYPTION_DOMAINS.CERTIFICATES);
    expect(decrypt(ciphertext, ENCRYPTION_DOMAINS.CERTIFICATES)).toBe(plaintext);
  });

  it("decrypt with wrong domain fails to produce correct plaintext", () => {
    const plaintext = "my-secret";
    const ciphertext = encrypt(plaintext, ENCRYPTION_DOMAINS.SECRETS);
    // Decrypting with a different domain should throw (auth tag mismatch)
    expect(() => decrypt(ciphertext, ENCRYPTION_DOMAINS.TOTP)).toThrow();
  });

  it("encrypts with default domain (generic) when no domain specified", () => {
    const plaintext = "no-domain-value";
    const ciphertext = encrypt(plaintext);
    // Should round-trip fine with no domain (defaults to generic)
    expect(decrypt(ciphertext)).toBe(plaintext);
  });
});

// ─── Error handling ────────────────────────────────────────────────────────

describe("decrypt error handling", () => {
  it("throws on corrupted ciphertext", () => {
    const ciphertext = encrypt("valid data");
    const b64 = ciphertext.slice("v2:".length);
    const corrupted = "v2:" + b64.slice(0, 10) + "XXXX" + b64.slice(14);
    expect(() => decrypt(corrupted)).toThrow();
  });

  it("throws on completely invalid base64", () => {
    expect(() => decrypt("v2:not-valid-base64!!!")).toThrow();
  });

  it("throws on truncated ciphertext", () => {
    const ciphertext = encrypt("some data");
    const b64 = ciphertext.slice("v2:".length);
    const truncated = "v2:" + b64.slice(0, 8);
    expect(() => decrypt(truncated)).toThrow();
  });
});

// ─── Missing NEXTAUTH_SECRET ───────────────────────────────────────────────

describe("missing NEXTAUTH_SECRET", () => {
  it("encrypt throws when NEXTAUTH_SECRET is unset and no V2 key", () => {
    const saved = process.env.NEXTAUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.VF_ENCRYPTION_KEY_V2;
    try {
      expect(() => encrypt("test")).toThrow("NEXTAUTH_SECRET");
    } finally {
      process.env.NEXTAUTH_SECRET = saved;
    }
  });

  it("decrypt throws when NEXTAUTH_SECRET is unset and no V2 key", () => {
    const ciphertext = encrypt("test");
    const saved = process.env.NEXTAUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.VF_ENCRYPTION_KEY_V2;
    try {
      expect(() => decrypt(ciphertext)).toThrow("NEXTAUTH_SECRET");
    } finally {
      process.env.NEXTAUTH_SECRET = saved;
    }
  });
});

// ─── V1 backward compatibility ─────────────────────────────────────────────

describe("V1 backward compatibility", () => {
  it("decrypt handles legacy V1 ciphertext (no v2: prefix)", () => {
    // Generate a V1-format ciphertext manually using the internal legacy helper
    const plaintext = "legacy-value";
    const legacyCiphertext = decryptLegacy
      ? (() => {
          // Use the exported legacy encrypt helper to generate a V1 payload
          const { createCipheriv, createHash, randomBytes } = require("node:crypto");
          const secret = process.env.NEXTAUTH_SECRET!;
          const key = createHash("sha256").update(secret).digest();
          const iv = randomBytes(12);
          const cipher = createCipheriv("aes-256-gcm", key, iv);
          const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
          const authTag = cipher.getAuthTag();
          return Buffer.concat([iv, authTag, encrypted]).toString("base64");
        })()
      : null;

    if (legacyCiphertext) {
      expect(decrypt(legacyCiphertext)).toBe(plaintext);
    }
  });

  it("decryptLegacy decrypts a V1 ciphertext", () => {
    const plaintext = "legacy-only-value";
    const { createCipheriv, createHash, randomBytes } = require("node:crypto");
    const secret = process.env.NEXTAUTH_SECRET!;
    const key = createHash("sha256").update(secret).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const v1Ciphertext = Buffer.concat([iv, authTag, encrypted]).toString("base64");

    expect(decryptLegacy(v1Ciphertext)).toBe(plaintext);
  });
});

// ─── VF_ENCRYPTION_KEY_V2 rotation ─────────────────────────────────────────

describe("VF_ENCRYPTION_KEY_V2 key rotation", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "test-secret-for-vitest";
    delete process.env.VF_ENCRYPTION_KEY_V2;
  });
  afterEach(() => {
    delete process.env.VF_ENCRYPTION_KEY_V2;
  });

  it("encrypts with V2 key when VF_ENCRYPTION_KEY_V2 is set", () => {
    process.env.VF_ENCRYPTION_KEY_V2 = "v2-rotation-key-for-testing";
    const ciphertext = encrypt("test");
    expect(ciphertext).toMatch(/^v2:/);
    expect(decrypt(ciphertext)).toBe("test");
  });

  it("data encrypted with V1 key still decryptable after setting V2 key", () => {
    // Encrypt without V2 key (uses NEXTAUTH_SECRET via HKDF)
    const plaintext = "encrypted-before-rotation";
    const ciphertextV1era = encrypt(plaintext);

    // Set V2 key for rotation
    process.env.VF_ENCRYPTION_KEY_V2 = "v2-rotation-key-for-testing";

    // Old data should still decrypt correctly
    expect(decrypt(ciphertextV1era)).toBe(plaintext);
  });

  it("new encryptions use V2 key, producing different ciphertext than V1-era", () => {
    const plaintext = "same-plaintext";

    // Encrypt without V2 key
    const ctBeforeRotation = encrypt(plaintext);

    // Set V2 key
    process.env.VF_ENCRYPTION_KEY_V2 = "v2-rotation-key-for-testing";

    // New encryption — same plaintext but different master key input
    const ctAfterRotation = encrypt(plaintext);

    // Both should decrypt correctly
    expect(decrypt(ctBeforeRotation)).toBe(plaintext);
    expect(decrypt(ctAfterRotation)).toBe(plaintext);

    // But the key material differs so decrypting ctAfterRotation without V2 key should fail
    delete process.env.VF_ENCRYPTION_KEY_V2;
    expect(() => decrypt(ctAfterRotation)).toThrow();
  });

  it("VF_ENCRYPTION_KEY_V2 can work without NEXTAUTH_SECRET", () => {
    process.env.VF_ENCRYPTION_KEY_V2 = "standalone-v2-key";
    delete process.env.NEXTAUTH_SECRET;
    try {
      const ciphertext = encrypt("standalone");
      expect(decrypt(ciphertext)).toBe("standalone");
    } finally {
      process.env.NEXTAUTH_SECRET = "test-secret-for-vitest";
    }
  });
});

// ─── HKDF key derivation ───────────────────────────────────────────────────

describe("HKDF key derivation properties", () => {
  it("same inputs produce same key (deterministic)", () => {
    // Two encryptions with same domain but different IVs should both decrypt
    const a = encrypt("value", ENCRYPTION_DOMAINS.SECRETS);
    const b = encrypt("value", ENCRYPTION_DOMAINS.SECRETS);
    expect(decrypt(a, ENCRYPTION_DOMAINS.SECRETS)).toBe("value");
    expect(decrypt(b, ENCRYPTION_DOMAINS.SECRETS)).toBe("value");
  });

  it("ENCRYPTION_DOMAINS exports expected domain constants", () => {
    expect(ENCRYPTION_DOMAINS.SECRETS).toBeDefined();
    expect(ENCRYPTION_DOMAINS.CERTIFICATES).toBeDefined();
    expect(ENCRYPTION_DOMAINS.TOTP).toBeDefined();
    expect(ENCRYPTION_DOMAINS.SESSIONS).toBeDefined();
    expect(ENCRYPTION_DOMAINS.GENERIC).toBeDefined();
  });
});
