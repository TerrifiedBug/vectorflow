import { prisma } from "@/lib/prisma";
import { warnLog } from "@/lib/logger";

/**
 * Per-organization VectorFlow Lake BYTE quota — a SOFT signal, never a hard drop.
 *
 * # Why soft
 *
 * The lake stores customer observability data in ClickHouse; silently dropping
 * events because an org crossed a byte ceiling is data-loss-unsafe. Enforcement
 * here is therefore advisory: when an org is over quota we emit a structured
 * warning (ops / Sentry surface) and expose the over-quota state for a read-only
 * UI badge (`lake.quotaStatus`). Retention (TTL — see `lake-retention.ts`) is the
 * mechanism that actually bounds storage; the quota only signals.
 *
 * # Provider seam (mirrors `src/server/services/quotas.ts`)
 *
 * The byte ceiling is supplied by an injectable `LakeQuotaProvider`. OSS ships
 * `DefaultUnlimitedLakeQuotaProvider` (every org → unlimited), so a self-hosted
 * deployment is unmetered by default — exactly like `DefaultUnboundedQuotaPolicy`
 * for agents/pipelines/environments. A commercial deployment registers its own
 * provider at startup via `setLakeQuotaProvider(...)` to map an org's tier to a
 * finite byte cap. The provider is keyed by `orgId` (the cloud resolves the org's
 * tier → bytes); implementations MUST be synchronous and cheap (a constant or a
 * cached tier lookup, no I/O) because `evaluateLakeQuota` runs on the ingest path.
 */

/** Provider interface — a deployment may register a commercial tier overlay. */
export interface LakeQuotaProvider {
  /**
   * Per-org Lake byte ceiling. `null` = unlimited (no quota enforcement, the OSS
   * default). MUST be synchronous and free of I/O — called on the ingest path.
   */
  getLakeQuotaBytes(orgId: string): bigint | null;
}

/**
 * Default OSS provider: every org is unlimited. Self-hosted deployments are
 * unmetered by default. To enforce a Lake byte ceiling, register a custom
 * provider at startup via `setLakeQuotaProvider(...)`.
 */
export class DefaultUnlimitedLakeQuotaProvider implements LakeQuotaProvider {
  getLakeQuotaBytes(_orgId: string): bigint | null {
    return null;
  }
}

let activeProvider: LakeQuotaProvider = new DefaultUnlimitedLakeQuotaProvider();

/**
 * Replace the active Lake quota provider. Intended to be called once at startup
 * by the deployment bootstrap. Returns the previous provider so a test can
 * restore it in `afterEach`.
 */
export function setLakeQuotaProvider(provider: LakeQuotaProvider): LakeQuotaProvider {
  const prev = activeProvider;
  activeProvider = provider;
  return prev;
}

/** Inspect the currently-registered provider. Mostly for tests. */
export function getLakeQuotaProvider(): LakeQuotaProvider {
  return activeProvider;
}

/** Reset to the OSS default. Provided for `afterEach` test cleanup. */
export function resetLakeQuotaProvider(): void {
  activeProvider = new DefaultUnlimitedLakeQuotaProvider();
}

export interface LakeQuotaResult {
  organizationId: string;
  /** Current cumulative lake bytes for the org (sum of the catalog's byteCount). */
  currentBytes: bigint;
  /** Byte ceiling; `null` = unlimited. */
  quotaBytes: bigint | null;
  /** True iff `currentBytes > quotaBytes` (always false when unlimited). */
  overQuota: boolean;
  /** Fraction of the quota used (0..1+); `null` when unlimited. Display-only. */
  usageRatio: number | null;
}

/**
 * PURE quota check — no I/O. `quotaBytes === null` means unlimited, so the org is
 * never over quota. `usageRatio` is computed via `bigint → number` and is
 * approximate above 2^53 bytes (~9 PB); it is a display value, not the gate.
 */
export function checkLakeQuota(
  orgId: string,
  currentBytes: bigint,
  quotaBytes: bigint | null,
): LakeQuotaResult {
  if (quotaBytes === null) {
    return {
      organizationId: orgId,
      currentBytes,
      quotaBytes: null,
      overQuota: false,
      usageRatio: null,
    };
  }
  const overQuota = currentBytes > quotaBytes;
  let usageRatio: number;
  if (quotaBytes > BigInt(0)) {
    usageRatio = Number(currentBytes) / Number(quotaBytes);
  } else {
    // A zero ceiling: any stored bytes is infinitely over; zero bytes is exactly at.
    usageRatio = currentBytes > BigInt(0) ? Number.POSITIVE_INFINITY : 0;
  }
  return { organizationId: orgId, currentBytes, quotaBytes, overQuota, usageRatio };
}

/**
 * Resolve the org's Lake byte ceiling from the active provider, sum the org's
 * lake bytes from the Postgres catalog (no ClickHouse read) and evaluate.
 *
 * SOFT: emits a warning when over quota — it never drops, rejects, or rolls back
 * data. Returns the result for read-only surfacing (UI badge / ops). When the
 * provider returns `null` (the OSS default) it short-circuits to an unlimited
 * result WITHOUT touching the database, so the unmetered path is free.
 */
export async function evaluateLakeQuota(orgId: string): Promise<LakeQuotaResult> {
  const quotaBytes = activeProvider.getLakeQuotaBytes(orgId);
  if (quotaBytes === null) {
    return checkLakeQuota(orgId, BigInt(0), null);
  }

  const agg = await prisma.lakeDataset.aggregate({
    where: { organizationId: orgId },
    _sum: { byteCount: true },
  });
  const currentBytes = agg._sum.byteCount ?? BigInt(0);

  const result = checkLakeQuota(orgId, currentBytes, quotaBytes);
  if (result.overQuota) {
    warnLog(
      "lake-quota",
      `Lake byte quota exceeded for org ${orgId}: ${currentBytes}/${quotaBytes} bytes ` +
        `(soft signal — data retained; reduce retention or raise the quota)`,
    );
  }
  return result;
}
