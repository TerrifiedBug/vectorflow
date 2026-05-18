import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  hkdfSync,
} from "node:crypto";
import { getDekCache } from "./kms";

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
        try {
          const fallbackKey = deriveKeyV2Nextauth(domain);
          return decryptWithKey(payload, fallbackKey);
        } catch (fallbackError) {
          const primary = activeKeyError instanceof Error ? activeKeyError.message : String(activeKeyError);
          const fallback = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          throw new Error(
            `Decryption failed with both keys — active: ${primary}; fallback (NEXTAUTH_SECRET): ${fallback}`,
          );
        }
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

// ─── v3 per-organization envelope encryption ───────────────────────────────

const V3_PREFIX = "v3:";
const V3_AAD_VERSION = "vf:v3";

export interface OrgEncryptionContext {
  /** The Organization.id this row belongs to. */
  orgId: string;
  /** The Organization.dataKeyCiphertext — wrapped DEK from the KMS provider. */
  dataKeyCiphertext: string;
  /** HKDF domain so that, e.g., a Secret key is independent from a Certificate key. */
  domain: EncryptionDomain;
  /** Prisma model name (or any stable per-table identifier) this row lives in. */
  rowTable: string;
  /** Primary key of the row being encrypted. */
  rowId: string;
}

/** Build the AAD that binds a v3 ciphertext to (org, domain, table, rowId). */
function buildAad(ctx: OrgEncryptionContext): Buffer {
  return Buffer.from(
    `${V3_AAD_VERSION}:org=${ctx.orgId}:domain=${ctx.domain}:row=${ctx.rowTable}:${ctx.rowId}`,
    "utf8",
  );
}

/** Per-domain key derived from the unwrapped DEK. Never persisted. */
function deriveDomainKey(dek: Buffer, domain: EncryptionDomain): Buffer {
  const info = Buffer.from(`vf:v3:${domain}`, "utf8");
  return Buffer.from(hkdfSync("sha256", dek, Buffer.alloc(0), info, 32));
}

/**
 * Encrypt `plaintext` with the org's DEK (unwrapped from `ctx.dataKeyCiphertext`
 * via the configured KMS provider). AAD binds the ciphertext to the org, domain,
 * table, and row — a ciphertext copied to another row or org cannot be decrypted.
 *
 * Output format: `v3:<base64(iv || authTag || ciphertext)>`.
 */
export async function encryptForOrg(
  plaintext: string,
  ctx: OrgEncryptionContext,
): Promise<string> {
  const cache = getDekCache();
  const dek = await cache.get(ctx.orgId, ctx.dataKeyCiphertext);
  const key = deriveDomainKey(dek, ctx.domain);
  try {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(buildAad(ctx));
    const enc = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return V3_PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
  } finally {
    key.fill(0);
  }
}

/**
 * Decrypt a `v3:` ciphertext bound to the supplied org context. Throws on AAD
 * mismatch, MAC failure, or malformed payload.
 */
export async function decryptForOrg(
  ciphertext: string,
  ctx: OrgEncryptionContext,
): Promise<string> {
  if (!ciphertext.startsWith(V3_PREFIX)) {
    throw new Error(`decryptForOrg: ciphertext missing "${V3_PREFIX}" prefix`);
  }
  const payload = Buffer.from(ciphertext.slice(V3_PREFIX.length), "base64");
  if (payload.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("decryptForOrg: ciphertext too short");
  }
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ct = payload.subarray(IV_LENGTH + TAG_LENGTH);
  const cache = getDekCache();
  const dek = await cache.get(ctx.orgId, ctx.dataKeyCiphertext);
  const key = deriveDomainKey(dek, ctx.domain);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(buildAad(ctx));
    decipher.setAuthTag(tag);
    return decipher.update(ct) + decipher.final("utf8");
  } finally {
    key.fill(0);
  }
}

/**
 * Derive a 32-byte per-org JWT signing key from the org's DEK using HKDF.
 *
 * The rotation counter is mixed into the HKDF `info` so the same DEK
 * yields a different key after `revokeOrgSessions` increments the
 * counter. This is the "owner-click invalidates all sessions" knob
 * from the security boundary — see `jwt-key.ts`.
 *
 * Rotates automatically with the DEK too: when the DEK changes (re-wrap
 * or customer-initiated rotation), all previously issued tokens are
 * invalidated.
 */
export function deriveJwtSigningKey(
  dek: Buffer,
  rotationCounter: number = 0,
): Buffer {
  if (dek.length !== 32) {
    throw new Error("deriveJwtSigningKey: DEK must be 32 bytes");
  }
  if (!Number.isInteger(rotationCounter) || rotationCounter < 0) {
    throw new Error(
      "deriveJwtSigningKey: rotationCounter must be a non-negative integer",
    );
  }
  // Encode the counter into the HKDF info so the derived key changes
  // when the counter changes. When rotationCounter is 0, use the legacy
  // `vf:v3:jwt` info (no suffix) to remain byte-identical with deployments
  // that minted JWTs before this field was introduced. Non-zero counters
  // use `vf:v3:jwt:r${rotationCounter}` to derive distinct keys.
  const info =
    rotationCounter === 0
      ? Buffer.from("vf:v3:jwt", "utf8")
      : Buffer.from(`vf:v3:jwt:r${rotationCounter}`, "utf8");
  return Buffer.from(hkdfSync("sha256", dek, Buffer.alloc(0), info, 32));
}
