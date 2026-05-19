/**
 * Audit-chain insert plumbing.
 *
 * Forward-only chain semantics:
 *   - Existing `AuditLog` rows at migration time have `prevHash IS NULL`
 *     and `hash IS NULL`. They predate the chain feature.
 *   - The chain starts at the first new write post-migration: that row's
 *     `prevHash = genesisHashFor(orgId)`. Subsequent writes link to the
 *     previous row's `hash`.
 *   - `verifyChain` ONLY validates chained rows (the export endpoint
 *     emits `WHERE hash IS NOT NULL`). Pre-feature legacy rows are not
 *     part of the integrity guarantee — they're documented as "outside
 *     the chain" in the customer audit export.
 *
 * We deliberately do NOT provide a retroactive backfill helper. Walking
 * NULL rows from genesis would create a permanent fork at the migration
 * boundary (the post-feature chain is already anchored to genesis). If a
 * customer later needs every historical row hashed, they take a downtime
 * window, drop the rows from the chain, run a single-pass rewrite, and
 * resume. That destructive operation lives in operator runbooks, not in
 * this module.
 */

import {
  computeChainHash,
  genesisHashFor,
  type ChainableAuditRow,
} from "./audit-chain";

/**
 * Compute the chain fields for a new row.
 *
 * @param row         The row content (must include `organizationId` and `createdAt`).
 * @param tailHash    The org's current chain tail (`AuditLog.hash` of the
 *                    most recent CHAINED row), or `null` if this is the
 *                    first chained row for the org.
 */
export function computeAuditChainInsert(
  row: ChainableAuditRow,
  tailHash: string | null,
): { prevHash: string; hash: string } {
  const prevHash = tailHash ?? genesisHashFor(row.organizationId);
  const hash = computeChainHash(prevHash, row);
  return { prevHash, hash };
}

/**
 * Adapter pattern for callers that maintain a separate audit chain
 * (e.g. the platform-operator audit table) and want to reuse the same
 * hashing primitive. Each implementer fetches the chain tail for the
 * supplied logical key (e.g. `platform-audit:<deploymentId>`).
 */
export interface AuditChainTailLookup {
  /** Most recent row's `hash` value, or null when the chain is empty. */
  getTailHash(key: string): Promise<string | null>;
}
