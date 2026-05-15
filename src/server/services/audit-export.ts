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

// ─── Chain-envelope export & verifier ──────────────────────────────────────

import {
  computeChainHash,
  genesisHashFor,
  type ChainableAuditRow,
} from "./audit-chain";

/**
 * AuditLog row shape extended with the chain fields persisted by the
 * `writeAuditLog` pipeline. Used by the chain export + verifier flow.
 */
export interface ChainAuditLogItem extends AuditLogItem {
  organizationId: string;
  userId: string | null;
  diff: unknown;
  userEmail: string | null;
  userName: string | null;
  /** sha256(prevHash || canonical(row)). Null for legacy pre-feature rows. */
  hash: string | null;
  /** Previous row's hash (or org genesis for the first chained row). */
  prevHash: string | null;
}

/** Envelope version. Bump when the on-the-wire shape changes incompatibly. */
export const AUDIT_EXPORT_VERIFIER_VERSION = 1;

export interface AuditExportEnvelope {
  verifierVersion: number;
  organizationId: string;
  exportedAt: string;
  rows: ChainExportRow[];
}

interface ChainExportRow {
  id: string;
  organizationId: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  diff: unknown;
  metadata: unknown;
  ipAddress: string | null;
  userEmail: string | null;
  userName: string | null;
  teamId: string | null;
  environmentId: string | null;
  createdAt: string; // ISO-8601
  prevHash: string;
  hash: string;
}

/**
 * Emit a chain-verifiable JSON envelope. Only rows with non-null `hash`
 * (i.e. rows written under the chain feature) are included; legacy
 * pre-feature rows are excluded because they sit outside the integrity
 * guarantee (forward-only chain semantics, see audit-chain-insert.ts).
 *
 * The envelope is what the bundled `verify-audit-chain.ts` script reads.
 */
export function formatAuditJsonChain(
  items: ChainAuditLogItem[],
  organizationId: string,
): string {
  const rows: ChainExportRow[] = [];
  for (const item of items) {
    if (item.hash == null || item.prevHash == null) continue;
    rows.push({
      id: item.id,
      organizationId: item.organizationId,
      userId: item.userId,
      action: item.action,
      entityType: item.entityType,
      entityId: item.entityId,
      diff: item.diff,
      metadata: item.metadata,
      ipAddress: item.ipAddress,
      userEmail: item.userEmail,
      userName: item.userName,
      teamId: item.teamId,
      environmentId: item.environmentId,
      createdAt: new Date(item.createdAt).toISOString(),
      prevHash: item.prevHash,
      hash: item.hash,
    });
  }
  // Sort by chain-link traversal: walk forward via prevHash → hash. This
  // is the only sort order that's safe under cross-process concurrent
  // writers (the per-org advisory lock serialises writes, but a paranoid
  // export should not rely on createdAt+id ordering — same-millisecond
  // ULID lex order does not match insertion order across pods).
  //
  // Topology:
  //   - byPrev[ prevHash ] = row whose prevHash is that value
  //   - start = the row whose prevHash is not anyone else's hash
  //     (i.e. the chain head — its predecessor is the org genesis or
  //     a row that didn't survive the filter)
  // If the chain is malformed (cycle, multiple starts, missing links),
  // we emit the rows as-is and let the verifier surface the issue. This
  // is strictly less safe than refusing to emit, but a customer-facing
  // export should still produce something they can audit.
  const byPrev = new Map<string, ChainExportRow>();
  for (const r of rows) byPrev.set(r.prevHash, r);
  const allHashes = new Set(rows.map((r) => r.hash));
  const starts = rows.filter((r) => !allHashes.has(r.prevHash));
  const traversal: ChainExportRow[] = [];
  if (starts.length === 1) {
    const seen = new Set<string>();
    let current: ChainExportRow | undefined = starts[0];
    while (current && !seen.has(current.hash)) {
      traversal.push(current);
      seen.add(current.hash);
      current = byPrev.get(current.hash);
    }
    if (traversal.length === rows.length) {
      rows.length = 0;
      rows.push(...traversal);
    }
  }
  // Fallback ordering when traversal couldn't reconstruct a single chain:
  // canonical createdAt-ASC, id-ASC. The verifier will report the break.
  if (traversal.length !== rows.length) {
    rows.sort((a, b) => {
      if (a.createdAt < b.createdAt) return -1;
      if (a.createdAt > b.createdAt) return 1;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });
  }
  const envelope: AuditExportEnvelope = {
    verifierVersion: AUDIT_EXPORT_VERIFIER_VERSION,
    organizationId,
    exportedAt: new Date().toISOString(),
    rows,
  };
  return JSON.stringify(envelope, null, 2);
}

export interface VerifyResult {
  valid: boolean;
  /** 0-based row index where the chain first fails. */
  brokenAt?: number;
  reason?: string;
}

/**
 * Verify a chain-envelope export. Returns `{ valid: true }` for a genuine
 * export, or `{ valid: false, brokenAt, reason }` pointing at the first
 * row whose chain doesn't hold.
 *
 * The bundled CLI `scripts/verify-audit-chain.ts` is a thin wrapper that
 * reads the envelope file and prints the result.
 */
export function verifyAuditExportEnvelope(
  raw: unknown,
): VerifyResult {
  if (typeof raw !== "object" || raw === null) {
    return { valid: false, reason: "envelope is not an object" };
  }
  const env = raw as Partial<AuditExportEnvelope>;
  if (env.verifierVersion !== AUDIT_EXPORT_VERIFIER_VERSION) {
    return {
      valid: false,
      reason: `unsupported verifierVersion ${env.verifierVersion}; expected ${AUDIT_EXPORT_VERIFIER_VERSION}`,
    };
  }
  if (typeof env.organizationId !== "string" || env.organizationId.length === 0) {
    return { valid: false, reason: "envelope organizationId missing or invalid" };
  }
  if (!Array.isArray(env.rows)) {
    return { valid: false, reason: "envelope rows array missing" };
  }
  if (env.rows.length === 0) return { valid: true };

  let expectedPrev = genesisHashFor(env.organizationId);
  for (let i = 0; i < env.rows.length; i++) {
    const raw = env.rows[i];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return {
        valid: false,
        brokenAt: i,
        reason: `row ${i}: not a plain object`,
      };
    }
    const row = raw as ChainExportRow;
    if (row.organizationId !== env.organizationId) {
      return {
        valid: false,
        brokenAt: i,
        reason: `row ${i}: organizationId mismatch`,
      };
    }
    if (typeof row.prevHash !== "string" || typeof row.hash !== "string") {
      return {
        valid: false,
        brokenAt: i,
        reason: `row ${i}: prevHash/hash missing or non-string`,
      };
    }
    if (row.prevHash !== expectedPrev) {
      return {
        valid: false,
        brokenAt: i,
        reason: `row ${i}: prevHash mismatch (chain link broken before this row)`,
      };
    }
    // Reconstruct a ChainableAuditRow with the row's content so we can
    // re-derive its hash exactly as the writer did. Any failure here
    // (e.g. tampered createdAt that JS rejects as Invalid Date) surfaces
    // as a deterministic row-level failure, NOT an uncaught exception.
    try {
      const ts = new Date(row.createdAt);
      if (Number.isNaN(ts.getTime())) {
        return {
          valid: false,
          brokenAt: i,
          reason: `row ${i}: createdAt is not a valid ISO-8601 timestamp`,
        };
      }
      const chainable: ChainableAuditRow = {
        id: row.id,
        organizationId: row.organizationId,
        userId: row.userId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        diff: row.diff,
        metadata: row.metadata,
        ipAddress: row.ipAddress,
        userEmail: row.userEmail,
        userName: row.userName,
        teamId: row.teamId,
        environmentId: row.environmentId,
        createdAt: ts,
      };
      const recomputed = computeChainHash(row.prevHash, chainable);
      if (recomputed !== row.hash) {
        return {
          valid: false,
          brokenAt: i,
          reason: `row ${i}: stored hash does not match content (row tampered)`,
        };
      }
    } catch (err) {
      return {
        valid: false,
        brokenAt: i,
        reason: `row ${i}: failed to reconstruct for hash verification (${err instanceof Error ? err.message : String(err)})`,
      };
    }
    expectedPrev = row.hash;
  }
  return { valid: true };
}
