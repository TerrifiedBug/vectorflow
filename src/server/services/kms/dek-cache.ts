import type { KmsProvider } from "./types";

interface CacheEntry {
  /** The wrapped ciphertext the entry was unwrapped from. Used to detect rotation. */
  ciphertext: string;
  key: Buffer;
  expiresAt: number;
  /** Pending unwrap. Lets concurrent `get()` calls share a single KMS round-trip. */
  inflight?: { ciphertext: string; promise: Promise<Buffer> };
}

export interface DekCacheOptions {
  /** TTL in ms. Default 5min. */
  ttlMs?: number;
}

/**
 * In-process cache for unwrapped DEKs.
 *
 * - **Keyed by `(orgId, dataKeyCiphertext)`.** When a customer rotates
 *   their DEK, the Organization's stored `dataKeyCiphertext` changes; the
 *   next `get()` observes the mismatch, zeros the stale plaintext, and
 *   unwraps the new ciphertext fresh. Without this, rotation would lag
 *   the cache TTL (defaulted to 5min) — minutes of failing encrypt/decrypt
 *   and stale JWT signing keys.
 * - **TTL-based eviction** (default 5 minutes).
 * - **Zero-on-evict.** `invalidate` / `invalidateAll` overwrite the cached
 *   `Buffer` with zeros in place so any retained reference is wiped too.
 * - **Single-flight.** Concurrent `get()` calls for the same `(org, ct)`
 *   share a single underlying `unwrapDataKey` call.
 * - **Warm-up.** `warm()` pre-populates the cache; used at stamp startup
 *   to absorb agent-reconnect storms without an outbound KMS spike.
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

    // Fast path: same ciphertext, still warm.
    if (
      cached &&
      cached.ciphertext === dataKeyCiphertext &&
      cached.expiresAt > now
    ) {
      return cached.key;
    }

    // Inflight unwrap for the same ciphertext? Join it.
    if (cached?.inflight && cached.inflight.ciphertext === dataKeyCiphertext) {
      return cached.inflight.promise;
    }

    // Stale (TTL expired) or rotation (different ciphertext) — discard cleanly.
    if (cached && cached.ciphertext !== dataKeyCiphertext) {
      cached.key.fill(0);
    }

    const promise = this.kms.unwrapDataKey(dataKeyCiphertext, orgId).then((key) => {
      this.entries.set(orgId, {
        ciphertext: dataKeyCiphertext,
        key,
        expiresAt: Date.now() + this.ttlMs,
      });
      return key;
    });

    this.entries.set(orgId, {
      ciphertext: dataKeyCiphertext,
      key: Buffer.alloc(0),
      expiresAt: 0,
      inflight: { ciphertext: dataKeyCiphertext, promise },
    });

    try {
      return await promise;
    } catch (err) {
      const e = this.entries.get(orgId);
      if (e?.inflight?.promise === promise) this.entries.delete(orgId);
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
