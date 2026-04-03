import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  hkdfSync,
} from "node:crypto";

// ─── Encryption domains ────────────────────────────────────────────────────

/**
 * Domain labels for HKDF key derivation.
 * Each domain produces an independent 256-bit key from the same master secret,
 * providing cryptographic separation between data types.
 */
export const ENCRYPTION_DOMAINS = {
  SECRETS: "secrets",
  CERTIFICATES: "certificates",
  TOTP: "totp",
  SESSIONS: "sessions",
  GENERIC: "generic",
} as const;

export type EncryptionDomain =
  (typeof ENCRYPTION_DOMAINS)[keyof typeof ENCRYPTION_DOMAINS];

// ─── Payload format constants ─────────────────────────────────────────────

const V2_PREFIX = "v2:";
const IV_LENGTH = 12;   // 96-bit nonce for AES-256-GCM
const TAG_LENGTH = 16;  // 128-bit auth tag

// ─── Key derivation ────────────────────────────────────────────────────────

/**
 * Derives a 32-byte AES key via HKDF-SHA256 from the given master secret.
 * The domain info string ensures keys are independent per data type.
 */
function hkdfDerive(master: string, domain: EncryptionDomain): Buffer {
  const ikm = Buffer.from(master, "utf8");
  const info = Buffer.from(`vectorflow:v2:${domain}`, "utf8");
  return Buffer.from(hkdfSync("sha256", ikm, Buffer.alloc(0), info, 32));
}

/**
 * Returns the HKDF key derived from the active master key.
 * Prefers VF_ENCRYPTION_KEY_V2 when set (rotation scenario),
 * otherwise uses NEXTAUTH_SECRET.
 */
function deriveKeyV2Active(domain: EncryptionDomain = ENCRYPTION_DOMAINS.GENERIC): Buffer {
  const v2Key = process.env.VF_ENCRYPTION_KEY_V2;
  if (v2Key) return hkdfDerive(v2Key, domain);

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      "NEXTAUTH_SECRET environment variable is required but not set",
    );
  }
  return hkdfDerive(secret, domain);
}

/**
 * Returns the HKDF key derived from NEXTAUTH_SECRET specifically.
 * Used as fallback when decrypting V2 payloads that were encrypted before
 * VF_ENCRYPTION_KEY_V2 was introduced.
 */
function deriveKeyV2Nextauth(domain: EncryptionDomain = ENCRYPTION_DOMAINS.GENERIC): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      "NEXTAUTH_SECRET environment variable is required but not set",
    );
  }
  return hkdfDerive(secret, domain);
}

/**
 * Derives the legacy V1 key using SHA-256 (original behavior).
 * Used only for decrypting existing V1 ciphertexts.
 */
function deriveKeyV1(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      "NEXTAUTH_SECRET environment variable is required but not set",
    );
  }
  return createHash("sha256").update(secret).digest();
}

// ─── Core primitives ───────────────────────────────────────────────────────

function encryptWithKey(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

function decryptWithKey(payload: Buffer, key: Buffer): string {
  if (payload.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Ciphertext is too short to be valid");
  }
  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = payload.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Encrypts plaintext using AES-256-GCM with an HKDF-derived key.
 *
 * Output format: `v2:<base64-encoded[IV|authTag|ciphertext]>`
 *
 * The optional `domain` parameter enables cryptographic key separation
 * between different data types (secrets, certs, TOTP, etc.).
 * Defaults to `ENCRYPTION_DOMAINS.GENERIC` for backward compatibility.
 */
export function encrypt(
  plaintext: string,
  domain: EncryptionDomain = ENCRYPTION_DOMAINS.GENERIC,
): string {
  const key = deriveKeyV2Active(domain);
  const payload = encryptWithKey(plaintext, key);
  return V2_PREFIX + payload.toString("base64");
}

/**
 * Decrypts a ciphertext produced by `encrypt`.
 *
 * Handles both formats:
 * - `v2:<base64>` — HKDF-derived key (current format)
 * - `<base64>` — Legacy V1 format (SHA-256-derived key, no prefix)
 *
 * For V2 ciphertexts, pass the same `domain` used during encryption.
 * V1 ciphertexts ignore the domain (single shared key).
 */
export function decrypt(
  ciphertext: string,
  domain: EncryptionDomain = ENCRYPTION_DOMAINS.GENERIC,
): string {
  if (ciphertext.startsWith(V2_PREFIX)) {
    const payload = Buffer.from(ciphertext.slice(V2_PREFIX.length), "base64");

    // Try the active key first (VF_ENCRYPTION_KEY_V2 if set, else NEXTAUTH_SECRET)
    const activeKey = deriveKeyV2Active(domain);
    try {
      return decryptWithKey(payload, activeKey);
    } catch (activeKeyError) {
      // If VF_ENCRYPTION_KEY_V2 is active, the payload may have been encrypted
      // before rotation using NEXTAUTH_SECRET HKDF. Try that as fallback.
      // AES-GCM auth tag failure guarantees we never silently accept wrong data.
      if (process.env.VF_ENCRYPTION_KEY_V2 && process.env.NEXTAUTH_SECRET) {
        const fallbackKey = deriveKeyV2Nextauth(domain);
        return decryptWithKey(payload, fallbackKey);
      }
      throw activeKeyError;
    }
  }

  // V1 legacy path — no prefix means old SHA-256-derived key
  return decryptLegacy(ciphertext);
}

/**
 * Decrypts a V1 (legacy) ciphertext using the original SHA-256-derived key.
 * Exported so the migration script can explicitly target V1 payloads.
 */
export function decryptLegacy(ciphertext: string): string {
  const payload = Buffer.from(ciphertext, "base64");
  const key = deriveKeyV1();
  return decryptWithKey(payload, key);
}
