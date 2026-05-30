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
 *
 * Returns the matched **absolute** time-step (counter) when the code is
 * valid, or `null` when it is invalid. The absolute step is the value the
 * caller persists (`User.lastTotpStep`) and compares against on the next
 * attempt so each code can only be consumed once within its window
 * (replay prevention — VF-16). Use `verifyTotpStep` for a boolean check
 * that does not need replay tracking (e.g. enabling/disabling 2FA in the
 * settings UI, where the session is already authenticated).
 */
export function verifyTotpCode(secretBase32: string, code: string): number | null {
  const totp = new TOTP({
    issuer: ISSUER,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secretBase32),
  });

  // delta returns null if invalid, or the time step difference (relative to
  // the current step) if valid. window:1 accepts the previous/current/next
  // 30s step.
  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) return null;

  // Convert the relative delta into an absolute monotonic counter so callers
  // can store and compare it across requests. otpauth uses Unix-epoch steps:
  // floor(now / period) is the current step.
  const currentStep = Math.floor(Date.now() / (PERIOD * 1000));
  return currentStep + delta;
}

/**
 * Boolean convenience wrapper around `verifyTotpCode` for call sites that
 * only need validity (no replay tracking), e.g. enabling/disabling 2FA from
 * an already-authenticated session.
 */
export function verifyTotpStep(secretBase32: string, code: string): boolean {
  return verifyTotpCode(secretBase32, code) !== null;
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
