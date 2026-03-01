import { TOTP, Secret } from "otpauth";
import { createHash, randomBytes } from "crypto";

const ISSUER = "VectorFlow";
const DIGITS = 6;
const PERIOD = 30;
const ALGORITHM = "SHA1";

/**
 * Generate a new TOTP secret and otpauth URI for QR code display.
 */
export function generateTotpSecret(email: string): { secret: string; uri: string } {
  const secret = new Secret({ size: 20 });

  const totp = new TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret,
  });

  return {
    secret: secret.base32,
    uri: totp.toString(),
  };
}

/**
 * Verify a 6-digit TOTP code against a base32 secret.
 * Allows ±1 time window for clock drift tolerance.
 */
export function verifyTotpCode(secretBase32: string, code: string): boolean {
  const totp = new TOTP({
    issuer: ISSUER,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secretBase32),
  });

  // delta returns null if invalid, or the time step difference if valid
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}

/**
 * Generate 10 random backup codes (8 chars each, alphanumeric).
 */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    codes.push(randomBytes(5).toString("hex").slice(0, 8).toUpperCase());
  }
  return codes;
}

/**
 * Hash a backup code for storage.
 */
export function hashBackupCode(code: string): string {
  return createHash("sha256").update(code.toUpperCase()).digest("hex");
}

/**
 * Verify a backup code against stored hashes.
 * Returns remaining hashes with the used code removed.
 */
export function verifyBackupCode(
  code: string,
  hashedCodes: string[],
): { valid: boolean; remaining: string[] } {
  const hash = hashBackupCode(code);
  const index = hashedCodes.indexOf(hash);

  if (index === -1) {
    return { valid: false, remaining: hashedCodes };
  }

  const remaining = [...hashedCodes];
  remaining.splice(index, 1);
  return { valid: true, remaining };
}
