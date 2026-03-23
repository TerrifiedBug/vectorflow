import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Set NEXTAUTH_SECRET before importing crypto module (it reads env at call time)
const ORIGINAL_SECRET = process.env.NEXTAUTH_SECRET;
beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-vitest";
});
afterAll(() => {
  if (ORIGINAL_SECRET !== undefined) {
    process.env.NEXTAUTH_SECRET = ORIGINAL_SECRET;
  } else {
    delete process.env.NEXTAUTH_SECRET;
  }
});

import { encrypt, decrypt } from "@/server/services/crypto";

// ─── encrypt/decrypt round-trip ────────────────────────────────────────────

describe("encrypt and decrypt", () => {
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

  it("produces base64-encoded ciphertext", () => {
    const ciphertext = encrypt("test");
    // Base64 alphabet: A-Za-z0-9+/=
    expect(ciphertext).toMatch(/^[A-Za-z0-9+/]+=*$/);
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

// ─── Error handling ────────────────────────────────────────────────────────

describe("decrypt error handling", () => {
  it("throws on corrupted ciphertext", () => {
    const ciphertext = encrypt("valid data");
    // Corrupt by changing characters in the middle
    const corrupted =
      ciphertext.slice(0, 10) + "XXXX" + ciphertext.slice(14);
    expect(() => decrypt(corrupted)).toThrow();
  });

  it("throws on completely invalid base64", () => {
    expect(() => decrypt("not-valid-base64!!!")).toThrow();
  });

  it("throws on truncated ciphertext", () => {
    const ciphertext = encrypt("some data");
    // Truncate to less than IV + authTag (12 + 16 = 28 bytes)
    const truncated = ciphertext.slice(0, 8);
    expect(() => decrypt(truncated)).toThrow();
  });
});

// ─── Missing NEXTAUTH_SECRET ───────────────────────────────────────────────

describe("missing NEXTAUTH_SECRET", () => {
  it("encrypt throws when NEXTAUTH_SECRET is unset", () => {
    const saved = process.env.NEXTAUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    try {
      expect(() => encrypt("test")).toThrow("NEXTAUTH_SECRET");
    } finally {
      process.env.NEXTAUTH_SECRET = saved;
    }
  });

  it("decrypt throws when NEXTAUTH_SECRET is unset", () => {
    // Encrypt with the secret set
    const ciphertext = encrypt("test");
    const saved = process.env.NEXTAUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    try {
      expect(() => decrypt(ciphertext)).toThrow("NEXTAUTH_SECRET");
    } finally {
      process.env.NEXTAUTH_SECRET = saved;
    }
  });
});
