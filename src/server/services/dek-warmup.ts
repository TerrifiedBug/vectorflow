/**
 * DEK cache warm-up on stamp startup (plan §12.5 SLO assumption,
 * §16b OSS item 4).
 *
 * The KMS request budget in §12.5 — ~12 unwraps/hour/org at 5min TTL —
 * is comfortable in steady state. The hot path is a **reconnect storm**:
 * after a stamp restart or rolling deploy, thousands of agents reconnect
 * simultaneously and each handler reaches for the per-org DEK. Without
 * a warm cache, every request races to unwrap from KMS at the same
 * moment, spiking outbound KMS RPS into the regional limit and burning
 * the p95 SLO for the first 30-60 seconds post-restart.
 *
 * `warmDekCacheForActiveOrgs()` is called from `instrumentation.node.ts`
 * during startup. It selects every non-suspended, non-deleted org with
 * a `dataKeyCiphertext` set, then asks the DekCache to unwrap each in
 * parallel. The DekCache's single-flight logic deduplicates concurrent
 * gets for the same `(orgId, ciphertext)` so it doesn't matter if some
 * Web handlers race the warm-up — the second arrival joins the in-flight
 * unwrap rather than issuing a duplicate KMS call.
 *
 * Failures are tolerated. Warm-up is a latency optimization, not a
 * correctness gate; a KMS hiccup at startup must not prevent the stamp
 * from booting. Per-org errors are logged at WARN level so the operator
 * can investigate post-deploy.
 *
 * Concurrency cap: a stamp with 10k orgs would otherwise dispatch 10k
 * KMS unwraps in parallel. We chunk them at `WARM_PARALLELISM` (default
 * 64) which keeps the AWS KMS RPS well under the regional limit
 * (5,500 RPS shared CMK) and lets a 10k-org stamp warm in roughly
 * `10000 / 64 * unwrap_latency` seconds — typically under 30s with a
 * 100ms-per-unwrap budget.
 */

import { infoLog, warnLog } from "@/lib/logger";

const WARM_PARALLELISM = Number(process.env.VF_DEK_WARM_PARALLELISM ?? "64");

export interface DekWarmupDeps {
  /**
   * Fetch organizations that need their DEK warmed. Defaults to Prisma
   * but exposed as an injection point for tests.
   */
  listOrgs?: () => Promise<
    Array<{ id: string; dataKeyCiphertext: string | null }>
  >;
  /**
   * The DekCache instance to populate. Defaults to `getDekCache()` from
   * the kms module; injected for tests.
   */
  cache?: {
    warm(
      entries: Array<{ orgId: string; dataKeyCiphertext: string }>,
    ): Promise<void>;
  };
  /**
   * Concurrency cap. Defaults to `WARM_PARALLELISM` env-derived value;
   * tests override to exercise chunking.
   */
  parallelism?: number;
}

export interface DekWarmupResult {
  attempted: number;
  succeeded: number;
  failed: number;
  durationMs: number;
}

/**
 * Pre-populate the in-process DEK cache for every active org. Safe to
 * call multiple times — subsequent calls within the TTL window are
 * effectively no-ops (the cache returns the warm entry without KMS).
 *
 * Returns counters for observability; errors per org are logged but
 * never thrown.
 */
export async function warmDekCacheForActiveOrgs(
  deps: DekWarmupDeps = {},
): Promise<DekWarmupResult> {
  const t0 = Date.now();

  const listOrgs = deps.listOrgs ?? (await defaultListOrgs());
  const cache = deps.cache ?? (await defaultDekCache());
  const parallelism = deps.parallelism ?? WARM_PARALLELISM;
  if (!Number.isFinite(parallelism) || !Number.isInteger(parallelism) || parallelism <= 0) {
    throw new Error(
      `dek-warmup: parallelism must be a positive integer, got ${parallelism}`,
    );
  }

  const orgs = await listOrgs();
  const candidates = orgs.filter(
    (o): o is { id: string; dataKeyCiphertext: string } =>
      typeof o.dataKeyCiphertext === "string" && o.dataKeyCiphertext.length > 0,
  );

  let succeeded = 0;
  let failed = 0;

  // Chunked concurrency: process WARM_PARALLELISM orgs at a time.
  for (let i = 0; i < candidates.length; i += parallelism) {
    const chunk = candidates.slice(i, i + parallelism);
    await cache
      .warm(
        chunk.map((o) => ({
          orgId: o.id,
          dataKeyCiphertext: o.dataKeyCiphertext,
        })),
      )
      .then(() => {
        succeeded += chunk.length;
      })
      .catch((err) => {
        // `cache.warm` swallows per-entry errors internally, so a thrown
        // error here means the underlying KMS provider is in a state
        // that warrants escalation rather than continuing.
        failed += chunk.length;
        warnLog("dek-warmup", "chunk failed", err);
      });
  }

  const durationMs = Date.now() - t0;
  infoLog(
    "dek-warmup",
    `warmed ${succeeded}/${candidates.length} org DEKs in ${durationMs}ms` +
      (failed > 0 ? ` (${failed} failed)` : ""),
  );

  return {
    attempted: candidates.length,
    succeeded,
    failed,
    durationMs,
  };
}

// ─── Defaults (lazy so tests can inject without pulling in Prisma) ──────────

async function defaultListOrgs() {
  const { prisma } = await import("@/lib/prisma");
  return async () =>
    prisma.organization.findMany({
      where: {
        suspendedAt: null,
        deletedAt: null,
        dataKeyCiphertext: { not: null },
      },
      select: { id: true, dataKeyCiphertext: true },
    });
}

async function defaultDekCache() {
  const { getDekCache } = await import("./kms");
  return getDekCache();
}
