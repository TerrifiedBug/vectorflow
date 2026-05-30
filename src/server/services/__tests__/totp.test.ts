import { describe, it, expect, vi } from "vitest";
import { TOTP, Secret } from "otpauth";
import {
  generateTotpSecret,
  verifyTotpCode,
  verifyTotpStep,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
} from "@/server/services/totp";

const PERIOD_SECONDS = 30;

// ─── generateTotpSecret ────────────────────────────────────────────────────

describe("generateTotpSecret", () => {
  it("returns a secret and uri for the given email", () => {
    const result = generateTotpSecret("alice@example.com");

    expect(result).toHaveProperty("secret");
    expect(result).toHaveProperty("uri");
    expect(typeof result.secret).toBe("string");
    expect(typeof result.uri).toBe("string");
  });

  it("uri contains the email as the label", () => {
    const result = generateTotpSecret("bob@corp.io");
    expect(result.uri).toContain("bob%40corp.io");
  });

  it("uri contains the issuer VectorFlow", () => {
    const result = generateTotpSecret("test@test.com");
    expect(result.uri).toContain("VectorFlow");
  });

  it("uri is a valid otpauth URI", () => {
    const result = generateTotpSecret("user@example.com");
    expect(result.uri).toMatch(/^otpauth:\/\/totp\//);
  });

  it("produces a base32 secret string", () => {
    const result = generateTotpSecret("user@example.com");
    // Base32 alphabet: A-Z and 2-7, optional padding with =
    expect(result.secret).toMatch(/^[A-Z2-7]+=*$/);
  });

  it("generates different secrets on successive calls", () => {
    const a = generateTotpSecret("same@email.com");
    const b = generateTotpSecret("same@email.com");
    expect(a.secret).not.toBe(b.secret);
  });
});

// ─── verifyTotpCode ────────────────────────────────────────────────────────

describe("verifyTotpCode", () => {
  it("returns the matched absolute step (a number) for a valid current code", () => {
    const { secret } = generateTotpSecret("test@example.com");

    // Generate a valid code using the same library
    const totp = new TOTP({
      issuer: "VectorFlow",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    });
    const validCode = totp.generate();

    const step = verifyTotpCode(secret, validCode);
    expect(typeof step).toBe("number");
    // For a current code (delta 0) the absolute step equals the current
    // Unix-epoch step counter.
    const expectedStep = Math.floor(Date.now() / (PERIOD_SECONDS * 1000));
    expect(step).toBe(expectedStep);
  });

  it("returns null for a wrong code", () => {
    const { secret } = generateTotpSecret("test@example.com");
    expect(verifyTotpCode(secret, "000000")).toBeNull();
  });

  it("returns null for a non-numeric code", () => {
    const { secret } = generateTotpSecret("test@example.com");
    expect(verifyTotpCode(secret, "abcdef")).toBeNull();
  });

  it("returns null for an empty code", () => {
    const { secret } = generateTotpSecret("test@example.com");
    expect(verifyTotpCode(secret, "")).toBeNull();
  });

  it("returns a monotonically increasing step as time advances (replay tracking basis)", () => {
    const { secret } = generateTotpSecret("test@example.com");
    const totp = new TOTP({
      issuer: "VectorFlow",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    });

    const now = 1_700_000_000_000; // fixed instant
    const currentStep = Math.floor(now / (PERIOD_SECONDS * 1000));
    const spy = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const code = totp.generate({ timestamp: now });
      // The same code validated at the current instant maps to currentStep.
      expect(verifyTotpCode(secret, code)).toBe(currentStep);

      // The previous step's code still validates within the ±1 window but maps
      // to currentStep - 1, which is strictly less than currentStep — exactly
      // the inequality the login path uses to reject replays.
      const prevCode = totp.generate({ timestamp: now - PERIOD_SECONDS * 1000 });
      expect(verifyTotpCode(secret, prevCode)).toBe(currentStep - 1);
    } finally {
      spy.mockRestore();
    }
  });
});

// ─── verifyTotpStep (boolean wrapper) ───────────────────────────────────────

describe("verifyTotpStep", () => {
  it("returns true for a valid current code", () => {
    const { secret } = generateTotpSecret("test@example.com");
    const totp = new TOTP({
      issuer: "VectorFlow",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    });
    expect(verifyTotpStep(secret, totp.generate())).toBe(true);
  });

  it("returns false for a wrong code", () => {
    const { secret } = generateTotpSecret("test@example.com");
    expect(verifyTotpStep(secret, "000000")).toBe(false);
  });
});

// ─── generateBackupCodes ───────────────────────────────────────────────────

describe("generateBackupCodes", () => {
  it("returns exactly 10 codes", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
  });

  it("each code is 8 characters long", () => {
    const codes = generateBackupCodes();
    for (const code of codes) {
      expect(code).toHaveLength(8);
    }
  });

  it("each code is uppercase hex", () => {
    const codes = generateBackupCodes();
    for (const code of codes) {
      expect(code).toMatch(/^[0-9A-F]{8}$/);
    }
  });

  it("codes are unique within a single generation", () => {
    const codes = generateBackupCodes();
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  it("successive calls produce different code sets", () => {
    const a = generateBackupCodes();
    const b = generateBackupCodes();
    // Extremely unlikely to be identical
    expect(a).not.toEqual(b);
  });
});

// ─── hashBackupCode ────────────────────────────────────────────────────────

describe("hashBackupCode", () => {
  it("returns a hex string (SHA-256 = 64 hex chars)", () => {
    const hash = hashBackupCode("ABCD1234");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input yields same hash", () => {
    const a = hashBackupCode("TEST1234");
    const b = hashBackupCode("TEST1234");
    expect(a).toBe(b);
  });

  it("is case-insensitive (uppercases input before hashing)", () => {
    const lower = hashBackupCode("abcd1234");
    const upper = hashBackupCode("ABCD1234");
    expect(lower).toBe(upper);
  });

  it("different inputs produce different hashes", () => {
    const a = hashBackupCode("CODE0001");
    const b = hashBackupCode("CODE0002");
    expect(a).not.toBe(b);
  });
});

// ─── verifyBackupCode ──────────────────────────────────────────────────────

describe("verifyBackupCode", () => {
  it("returns valid: true and removes the matched hash when found", () => {
    const code = "TESTCODE";
    const hash = hashBackupCode(code);
    const otherHash = hashBackupCode("OTHERCODE");
    const hashes = [otherHash, hash];

    const result = verifyBackupCode(code, hashes);

    expect(result.valid).toBe(true);
    expect(result.remaining).toEqual([otherHash]);
    expect(result.remaining).not.toContain(hash);
  });

  it("returns valid: false and unchanged hashes when not found", () => {
    const hashes = [hashBackupCode("AAA"), hashBackupCode("BBB")];
    const result = verifyBackupCode("NOTEXIST", hashes);

    expect(result.valid).toBe(false);
    expect(result.remaining).toEqual(hashes);
  });

  it("is case-insensitive (lowercase input matches uppercase-hashed code)", () => {
    const code = "MYCODE12";
    const hash = hashBackupCode(code);
    const hashes = [hash];

    // Lowercase input should still match because hashBackupCode uppercases
    const result = verifyBackupCode("mycode12", hashes);
    expect(result.valid).toBe(true);
    expect(result.remaining).toEqual([]);
  });

  it("does not mutate the original hashes array", () => {
    const code = "TARGET";
    const hash = hashBackupCode(code);
    const original = [hashBackupCode("OTHER"), hash];
    const originalCopy = [...original];

    verifyBackupCode(code, original);

    expect(original).toEqual(originalCopy);
  });

  it("handles empty hashes array", () => {
    const result = verifyBackupCode("ANYTHING", []);
    expect(result.valid).toBe(false);
    expect(result.remaining).toEqual([]);
  });

  it("only removes the first matching hash if duplicates exist", () => {
    const code = "DUPED";
    const hash = hashBackupCode(code);
    const hashes = [hash, hash, hashBackupCode("OTHER")];

    const result = verifyBackupCode(code, hashes);

    expect(result.valid).toBe(true);
    // Should have removed only the first occurrence
    expect(result.remaining).toHaveLength(2);
    expect(result.remaining).toContain(hash);
  });
});
