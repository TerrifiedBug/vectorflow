/**
 * Append-only hash chain for AuditLog tamper-evidence.
 *
 * On every insert:
 *   prevHash = previous row's hash (or genesisHashFor(orgId) for the first row)
 *   hash     = sha256(prevHash || canonicalize(row))
 *
 * Exporting an audit log dumps `{ row, prevHash }` in insertion order. The
 * bundled verifier recomputes each hash and points at the first index where
 * the chain breaks. Defeats the basic attack of an operator deleting or
 * modifying a single row to erase an access event without leaving evidence.
 *
 * This is intentionally simpler than a Merkle tree + external anchor — the
 * goal is "easy attack is now detectable", not "tampering is impossible".
 * Upgrading to external anchoring is mechanical and additive.
 */

import { createHash } from "node:crypto";

/**
 * Shape of an AuditLog row that participates in the chain. We deliberately
 * accept a subset of the Prisma type so the same canonicalization routine
 * is portable across the export endpoint, the verifier script, and tests.
 */
export interface ChainableAuditRow {
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
  createdAt: Date;
}

/**
 * Stable JSON canonicalization that round-trips bit-identically through
 * Postgres JSONB persistence.
 *
 * - Plain objects: keys sorted lexicographically at every level. Object
 *   properties whose value is `undefined` are **omitted** (matching the
 *   documented behaviour of `JSON.stringify`, which Prisma uses to
 *   serialise JSONB values).
 * - Arrays: order preserved (arrays are positional, not associative).
 *   `undefined` elements are emitted as `null` (also matching
 *   `JSON.stringify`'s array-sentinel behaviour).
 * - `Date` instances: serialised as ISO-8601 strings so a `Date` and the
 *   round-tripped string it would become after a Postgres JSONB cycle
 *   hash identically.
 * - Top-level `null` is preserved (null is a real JSON value; only
 *   `undefined` is the omit sentinel).
 * - Other primitives: passed through verbatim.
 *
 * Necessary because Prisma persists `AuditLog.diff` / `metadata` as JSONB
 * and Postgres serialises JSON values using JSON.stringify semantics —
 * dropping `undefined` and re-emitting key insertion order arbitrarily.
 * Without these rules, `verifyChain` would reject untouched rows whose
 * stored representation differs from the input shape.
 */
function stableCanonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (value === undefined) return null; // top-level / array element sentinel
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((v) => (v === undefined ? null : stableCanonicalize(v)));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      const v = obj[k];
      if (v === undefined) continue; // omit, match JSON.stringify
      out[k] = stableCanonicalize(v);
    }
    return out;
  }
  return value;
}

/** Canonical JSON for the row: sorted top-level + sorted nested. */
export function canonicalizeAuditRow(row: ChainableAuditRow): string {
  const ordered: Record<string, unknown> = {
    action: row.action,
    createdAt: row.createdAt.toISOString(),
    diff: stableCanonicalize(row.diff),
    entityId: row.entityId,
    entityType: row.entityType,
    environmentId: row.environmentId,
    id: row.id,
    ipAddress: row.ipAddress,
    metadata: stableCanonicalize(row.metadata),
    organizationId: row.organizationId,
    teamId: row.teamId,
    userEmail: row.userEmail,
    userId: row.userId,
    userName: row.userName,
  };
  // `ordered` keys are already alphabetical above; `JSON.stringify` walks
  // them in insertion order, so we get a stable top-level layout. Nested
  // objects are sorted by `stableCanonicalize`.
  return JSON.stringify(ordered);
}

/** Genesis prevHash for the very first row of an org's chain. */
export function genesisHashFor(orgId: string): string {
  return createHash("sha256").update(`vf:audit-genesis:${orgId}`).digest("hex");
}

/** sha256(prevHash || canonical(row)). */
export function computeChainHash(
  prevHash: string,
  row: ChainableAuditRow,
): string {
  return createHash("sha256")
    .update(prevHash)
    .update(canonicalizeAuditRow(row))
    .digest("hex");
}

export interface AuditChainEntry extends ChainableAuditRow {
  prevHash: string;
  /**
   * The chain hash for this row: `sha256(prevHash || canonical(row))`.
   * Persisting it lets `verifyChain` point at the *tampered* row directly
   * rather than at the next row whose prevHash no longer matches.
   */
  hash: string;
}

export interface VerifyResult {
  valid: boolean;
  brokenAt?: number;
  reason?: string;
}

/**
 * Verify the integrity of an audit-log chain export.
 *
 * Walks rows in insertion order. For each row, asserts:
 *   1. `prevHash` equals the previous row's `hash` (or genesis for the
 *      first row).
 *   2. `hash` equals `computeChainHash(prevHash, row)` — catches in-place
 *      mutation of the row's content without re-deriving its hash.
 */
export function verifyChain(
  entries: AuditChainEntry[],
  orgId: string,
): VerifyResult {
  if (entries.length === 0) return { valid: true };
  let expectedPrev = genesisHashFor(orgId);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.organizationId !== orgId) {
      return {
        valid: false,
        brokenAt: i,
        reason: `row ${i}: organizationId is "${entry.organizationId}", expected "${orgId}"`,
      };
    }
    if (entry.prevHash !== expectedPrev) {
      return {
        valid: false,
        brokenAt: i,
        reason: `row ${i}: prevHash mismatch (chain link broken before this row)`,
      };
    }
    const recomputed = computeChainHash(entry.prevHash, entry);
    if (recomputed !== entry.hash) {
      return {
        valid: false,
        brokenAt: i,
        reason: `row ${i}: stored hash does not match content (row tampered)`,
      };
    }
    expectedPrev = entry.hash;
  }
  return { valid: true };
}

/**
 * Convenience for the insert path: compute the next chain hash given the
 * tail-row hash (or the genesis if this is the first row).
 */
export function nextChainHash(
  tailHash: string | null,
  orgId: string,
  row: ChainableAuditRow,
): { prevHash: string; hash: string } {
  const prev = tailHash ?? genesisHashFor(orgId);
  const hash = computeChainHash(prev, row);
  return { prevHash: prev, hash };
}
