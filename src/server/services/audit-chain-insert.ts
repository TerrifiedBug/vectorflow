/**
 * Audit-chain insert + backfill plumbing.
 *
 * Two consumers:
 *   1. The `writeAudit` path (Prisma `audit.create` callers): given the
 *      row about to be inserted and the org's current tail hash, returns
 *      `{ prevHash, hash }` to persist.
 *   2. The backfill script: walks an org's existing rows in `createdAt`
 *      order and fills in the chain for rows whose `prevHash` is empty.
 *      Idempotent — re-running over rows that already have hashes
 *      preserves them.
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
 *                    most recent row), or `null` if this is the first row.
 */
export function computeAuditChainInsert(
  row: ChainableAuditRow,
  tailHash: string | null,
): { prevHash: string; hash: string } {
  const prevHash = tailHash ?? genesisHashFor(row.organizationId);
  const hash = computeChainHash(prevHash, row);
  return { prevHash, hash };
}

export interface BackfillRow extends ChainableAuditRow {
  prevHash: string;
  hash: string;
}

export interface BackfillCallbacks {
  /** Yields rows in (organizationId, createdAt) order for the given org. */
  iterate(): AsyncIterable<BackfillRow> | Iterable<BackfillRow>;
  /** Persist `prevHash` and `hash` on the row identified by `id`. */
  write(id: string, prevHash: string, hash: string): Promise<void>;
}

/**
 * Walk an org's rows in order, computing chain fields for any row whose
 * `hash` is empty. Re-running over already-chained rows leaves them
 * untouched, so the script can resume after interruption.
 */
export async function backfillChainForOrg(
  orgId: string,
  cb: BackfillCallbacks,
): Promise<void> {
  let tailHash: string | null = null;
  for await (const row of cb.iterate()) {
    if (row.hash && row.hash.length > 0) {
      // Already chained — trust it and use as the tail for subsequent rows.
      tailHash = row.hash;
      continue;
    }
    const { prevHash, hash } = computeAuditChainInsert(row, tailHash);
    await cb.write(row.id, prevHash, hash);
    tailHash = hash;
  }
}

/**
 * Adapter the cloud/ workspace's PlatformAuditLog writer plugs in to to
 * reuse the same hashing primitive. Each implementer fetches the chain
 * tail for the supplied logical key (e.g. `platform-audit:<stamp>`).
 */
export interface AuditChainTailLookup {
  /** Most recent row's `hash` value, or null when the chain is empty. */
  getTailHash(key: string): Promise<string | null>;
}
