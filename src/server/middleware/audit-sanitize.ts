export const SENSITIVE_KEYS = new Set([
  "password", "currentPassword", "newPassword",
  "token", "secret", "key", "keyBase64",
  "passwordHash", "httpsToken", "sshKey",
  "aiApiKey",
  "hmacSecret", "smtpPass", "integrationKey", "webhookUrl",
]);

export function sanitizeInput(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map(sanitizeInput);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizeInput(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function computeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { old: unknown; new: unknown }> | null {
  const diff: Record<string, { old: unknown; new: unknown }> = {};
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    if (key === "updatedAt" || key === "createdAt") continue;
    if (SENSITIVE_KEYS.has(key)) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        diff[key] = { old: "[REDACTED]", new: "[REDACTED]" };
      }
      continue;
    }

    const oldVal = before[key];
    const newVal = after[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diff[key] = { old: oldVal, new: newVal };
    }
  }

  return Object.keys(diff).length > 0 ? diff : null;
}
