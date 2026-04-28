import { encrypt, decrypt, ENCRYPTION_DOMAINS } from "./crypto";

export const SENSITIVE_FIELDS_BY_TYPE: Record<string, readonly string[]> = {
  webhook:   ["hmacSecret", "headers"],
  slack:     ["webhookUrl"],
  pagerduty: ["integrationKey"],
  email:     ["smtpPass"],
};

// Channel-secrets-specific wrapper around crypto.ts ciphertext.
// Distinguishes our encrypted blobs from arbitrary user input that may happen
// to begin with crypto.ts's own "v2:" prefix (e.g., a literal secret token).
export const ENCRYPTED_MARKER = "vfenc1:";

function isAlreadyEncrypted(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(ENCRYPTED_MARKER);
}

function serializeForEncryption(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function encryptChannelConfig(
  type: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const fields = SENSITIVE_FIELDS_BY_TYPE[type];
  if (!fields) return config;

  const out: Record<string, unknown> = { ...config };
  for (const field of fields) {
    const value = out[field];
    if (value === undefined || value === null || value === "") continue;
    if (isAlreadyEncrypted(value)) continue;
    out[field] = ENCRYPTED_MARKER + encrypt(serializeForEncryption(value), ENCRYPTION_DOMAINS.SECRETS);
  }
  return out;
}

export function decryptChannelConfig(
  type: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const fields = SENSITIVE_FIELDS_BY_TYPE[type];
  if (!fields) return config;

  const out: Record<string, unknown> = { ...config };
  for (const field of fields) {
    const value = out[field];
    if (typeof value !== "string" || !value.startsWith(ENCRYPTED_MARKER)) continue;
    const ciphertext = value.slice(ENCRYPTED_MARKER.length);
    const plaintext = decrypt(ciphertext, ENCRYPTION_DOMAINS.SECRETS);
    if (field === "headers") {
      out[field] = JSON.parse(plaintext);
    } else {
      out[field] = plaintext;
    }
  }
  return out;
}
