export const SENSITIVE_KEYS = new Set([
  "password", "currentPassword", "newPassword",
  "token", "secret", "key", "keyBase64",
  "passwordHash", "httpsToken", "sshKey",
  "secretId", "clientSecret", "jwt",
  "aiApiKey",
  "hmacSecret", "smtpPass", "integrationKey", "webhookUrl",
]);

export function sanitizeInput(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input !== "object") return input;
  if (input instanceof Date) return input.toISOString();
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
      diff[key] = {
        old: sanitizeInput(oldVal),
        new: sanitizeInput(newVal),
      };
    }
  }

  return Object.keys(diff).length > 0 ? diff : null;
}

// ─── Strict allowlist for audit sanitization ──────────────────────────────────
//
// The legacy `SENSITIVE_KEYS` denylist + `sanitizeInput` is the OSS default:
// known-sensitive keys are redacted; everything else flows through. That
// model is fine for self-hosted where the operator IS the customer. The
// strict mode takes the opposite approach — "anything not explicitly
// allowed is [REDACTED]" — so a forgotten new column doesn't silently leak
// into audit exports.
//
// `AUDIT_SAFE_KEYS` is the curated allowlist. `sanitizeInputStrict`
// emits the source value only when the key is in the allowlist; any
// other key surfaces as `[REDACTED]`. The overlay can switch the
// `audit.diff`/`audit.metadata` write paths to use this function; OSS
// keeps the existing `sanitizeInput` behaviour.
//
// The allowlist is intentionally conservative — additions are reviewed
// per-PR since each one expands the audit-export surface.

export const AUDIT_SAFE_KEYS = new Set<string>([
  // Identifiers
  "id",
  "organizationId",
  "environmentId",
  "teamId",
  "userId",
  "pipelineId",
  "nodeId",
  "alertRuleId",
  "channelId",
  "certificateId",
  // Names and labels
  "name",
  "slug",
  "displayName",
  "description",
  "label",
  // Lifecycle timestamps
  "createdAt",
  "updatedAt",
  "deployedAt",
  "suspendedAt",
  "deletedAt",
  "expiresAt",
  "scheduledAt",
  // Status / state enums
  "status",
  "state",
  "enabled",
  "active",
  "level",
  "severity",
  "type",
  "kind",
  "role",
  "tier",
  "plan",
  "phase",
  // Numeric counters / quotas / sizes
  "version",
  "count",
  "total",
  "limit",
  "size",
  "sizeBytes",
  "retentionDays",
  "retentionCount",
  "timeoutMs",
  "intervalMs",
  // Configuration shapes that are universally safe
  "region",
  "cronExpression",
  "metric",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

/**
 * Strict (allowlist) sanitizer. Mirrors `sanitizeInput` but redacts any
 * key not present in `AUDIT_SAFE_KEYS`. Recurses through nested objects
 * and arrays so a nested unknown key cannot escape via deep nesting.
 *
 * - Primitives (string/number/boolean/null/undefined) pass through.
 * - `Date` instances → ISO-8601 strings.
 * - Arrays are walked element-wise.
 * - Objects are walked key-by-key; allowlist hits pass through, misses
 *   become the string `"[REDACTED]"`.
 */
export function sanitizeInputStrict(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input !== "object") return input;
  if (input instanceof Date) return input.toISOString();
  if (Array.isArray(input)) return input.map(sanitizeInputStrict);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!AUDIT_SAFE_KEYS.has(key)) {
      // Always emit a leaf redaction for non-allowlisted KEYS. We do NOT
      // walk into the value — even a structurally-safe nested object
      // under an unknown key may carry data the operator hasn't reviewed
      // for safety. The whole subtree collapses to the redaction string.
      result[key] = "[REDACTED]";
      continue;
    }
    // Allowlisted key: preserve the structure of the value. Walk into
    // nested objects/arrays so unknown nested keys still get redacted.
    if (isPlainObject(value) || Array.isArray(value)) {
      result[key] = sanitizeInputStrict(value);
    } else if (value instanceof Date) {
      result[key] = value.toISOString();
    } else {
      result[key] = value;
    }
  }
  return result;
}
