// src/server/services/audit-export.ts

/**
 * Server-side audit log export formatting (CSV and JSON).
 */

export interface AuditLogItem {
  id: string;
  createdAt: Date;
  action: string;
  entityType: string;
  entityId: string;
  teamId: string | null;
  environmentId: string | null;
  ipAddress: string | null;
  metadata: unknown;
  user: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
}

// ─── CSV helpers ────────────────────────────────────────────────────────────

const FORMULA_PREFIXES = ["=", "+", "-", "@"];

/**
 * Escape a value for CSV output.
 *
 * - Wraps in double-quotes when the value contains commas, quotes, or newlines.
 * - Doubles internal quotes (RFC 4180).
 * - Prefixes cells starting with `=`, `+`, `-`, `@` with a single quote
 *   to prevent formula injection in spreadsheet applications.
 */
function csvEscape(value: string): string {
  let escaped = value;

  // Formula injection protection — prefix with a single quote
  if (FORMULA_PREFIXES.some((p) => escaped.startsWith(p))) {
    escaped = `'${escaped}`;
  }

  if (escaped.includes(",") || escaped.includes('"') || escaped.includes("\n")) {
    return `"${escaped.replace(/"/g, '""')}"`;
  }
  return escaped;
}

// ─── Public API ─────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  "Timestamp",
  "User",
  "Email",
  "Action",
  "Entity Type",
  "Entity ID",
  "Team ID",
  "Environment ID",
  "IP Address",
  "Details",
];

/**
 * Format audit log items as a CSV string.
 */
export function formatAuditCsv(items: AuditLogItem[]): string {
  const rows = items.map((item) => [
    csvEscape(new Date(item.createdAt).toISOString()),
    csvEscape(item.user?.name ?? ""),
    csvEscape(item.user?.email ?? ""),
    csvEscape(item.action),
    csvEscape(item.entityType),
    csvEscape(item.entityId),
    csvEscape(item.teamId ?? ""),
    csvEscape(item.environmentId ?? ""),
    csvEscape(item.ipAddress ?? ""),
    csvEscape(item.metadata ? JSON.stringify(item.metadata) : ""),
  ]);

  return [CSV_HEADERS.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

/**
 * Format audit log items as a JSON string.
 */
export function formatAuditJson(items: AuditLogItem[]): string {
  const data = items.map((item) => ({
    id: item.id,
    timestamp: new Date(item.createdAt).toISOString(),
    user: item.user?.name ?? null,
    email: item.user?.email ?? null,
    action: item.action,
    entityType: item.entityType,
    entityId: item.entityId,
    teamId: item.teamId,
    environmentId: item.environmentId,
    ipAddress: item.ipAddress,
    metadata: item.metadata ?? null,
  }));

  return JSON.stringify(data, null, 2);
}
