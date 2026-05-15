import type { KmsProvider } from "./types";

interface CacheEntry {
  key: Buffer;
  expiresAt: number;
  inflight?: Promise<Buffer>;
}

export interface DekCacheOptions {
  /** TTL in ms. Default 5min. */
  ttlMs?: number;
}

/**
 * In-process cache for unwrapped DEKs.
 *
 * - TTL-based eviction (default 5 minutes).
 * - On `invalidate` / `invalidateAll`, the cached `Buffer` is overwritten
 *   with zeros in place so that any retained references no longer hold
 *   the key material.
 * - Single-flight: concurrent `get()` for the same org dedupes to a
 *   single underlying `unwrapDataKey` call.
 * - `warm()` pre-populates the cache; used at stamp startup to absorb the
 *   reconnect storm without an outbound KMS spike.
 */
export class DekCache {
  private entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(
    private readonly kms: KmsProvider,
    opts: DekCacheOptions = {},
  ) {
    this.ttlMs = opts.ttlMs ?? 5 * 60 * 1000;
  }

  async get(orgId: string, dataKeyCiphertext: string): Promise<Buffer> {
    const now = Date.now();
    const cached = this.entries.get(orgId);
    if (cached && cached.expiresAt > now) {
      return cached.key;
    }
    if (cached?.inflight) {
      return cached.inflight;
    }

    const inflight = this.kms.unwrapDataKey(dataKeyCiphertext, orgId).then((key) => {
      this.entries.set(orgId, {
        key,
        expiresAt: Date.now() + this.ttlMs,
      });
      return key;
    });

    this.entries.set(orgId, {
      key: cached?.key ?? Buffer.alloc(0),
      expiresAt: cached?.expiresAt ?? 0,
      inflight,
    });

    try {
      return await inflight;
    } catch (err) {
      // On error, drop the inflight marker so retries can proceed.
      const e = this.entries.get(orgId);
      if (e?.inflight === inflight) this.entries.delete(orgId);
      throw err;
    }
  }

  invalidate(orgId: string): void {
    const e = this.entries.get(orgId);
    if (!e) return;
    e.key.fill(0);
    this.entries.delete(orgId);
  }

  invalidateAll(): void {
    for (const e of this.entries.values()) e.key.fill(0);
    this.entries.clear();
  }

  async warm(
    entries: Array<{ orgId: string; dataKeyCiphertext: string }>,
  ): Promise<void> {
    await Promise.all(
      entries.map(({ orgId, dataKeyCiphertext }) =>
        this.get(orgId, dataKeyCiphertext).catch(() => undefined),
      ),
    );
  }
}
