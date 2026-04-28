import { encrypt, decrypt, ENCRYPTION_DOMAINS } from "./crypto";

export const SENSITIVE_FIELDS_BY_TYPE: Record<string, readonly string[]> = {
  webhook:   ["hmacSecret", "headers"],
  slack:     ["webhookUrl"],
  pagerduty: ["integrationKey"],
  email:     ["smtpPass"],
};

const V2_PREFIX = "v2:";

function isAlreadyEncrypted(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(V2_PREFIX);
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
    out[field] = encrypt(serializeForEncryption(value), ENCRYPTION_DOMAINS.SECRETS);
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
    if (typeof value !== "string" || !value.startsWith(V2_PREFIX)) continue;
    const plaintext = decrypt(value, ENCRYPTION_DOMAINS.SECRETS);
    // headers was originally an object; restore it
    if (field === "headers") {
      out[field] = JSON.parse(plaintext);
    } else {
      out[field] = plaintext;
    }
  }
  return out;
}
