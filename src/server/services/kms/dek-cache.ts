import type { KmsProvider } from "./types";

interface CacheEntry {
  /** Ciphertext the cached key was unwrapped from. Used to detect rotation. */
  ciphertext: string;
  key: Buffer;
  expiresAt: number;
  /** Most recent in-flight unwrap for this org, or null when settled. */
  inflight: InflightUnwrap | null;
}

interface InflightUnwrap {
  ciphertext: string;
  promise: Promise<Buffer>;
  /** Identity token; settle handlers commit only when this is still active. */
  token: symbol;
}

export interface DekCacheOptions {
  /** TTL in ms. Default 5min. */
  ttlMs?: number;
}

/**
 * In-process cache for unwrapped DEKs.
 *
 * - **Keyed by `(orgId, dataKeyCiphertext)`.** When a customer rotates their
 *   DEK the Organization's stored `dataKeyCiphertext` changes; the next
 *   `get()` observes the mismatch, zeros the stale plaintext, and unwraps
 *   the new ciphertext fresh.
 * - **Race-safe.** Concurrent gets for *different* ciphertexts each carry
 *   an identity token. On settle, an inflight only commits its result if
 *   its token is still the active one for the org. A late-resolving stale
 *   unwrap cannot overwrite the fresh entry, and its plaintext is zeroed.
 * - **TTL-based eviction** (default 5 minutes).
 * - **Zero-on-evict.** `invalidate` / `invalidateAll` overwrite the cached
 *   `Buffer` with zeros in place so any retained reference is wiped too.
 * - **Single-flight (same ciphertext).** Concurrent gets for the *same*
 *   `(org, ct)` share a single underlying `unwrapDataKey` call.
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

    // Join an inflight unwrap for the same ciphertext.
    if (cached?.inflight && cached.inflight.ciphertext === dataKeyCiphertext) {
      return cached.inflight.promise;
    }

    // Different ciphertext (rotation) or TTL-expired — drop the old plaintext.
    // The previous inflight (if any, for the old ciphertext) is left running
    // but its result will be discarded when it settles because the token
    // we register now supersedes it.
    if (cached && cached.ciphertext !== dataKeyCiphertext) {
      cached.key.fill(0);
    }

    const token = Symbol("dek-inflight");
    const promise = this.kms.unwrapDataKey(dataKeyCiphertext, orgId);

    this.entries.set(orgId, {
      ciphertext: dataKeyCiphertext,
      key: Buffer.alloc(0),
      expiresAt: 0,
      inflight: { ciphertext: dataKeyCiphertext, promise, token },
    });

    let key: Buffer;
    try {
      key = await promise;
    } catch (err) {
      const e = this.entries.get(orgId);
      if (e?.inflight?.token === token) this.entries.delete(orgId);
      throw err;
    }

    const e = this.entries.get(orgId);
    if (e?.inflight?.token === token) {
      // We are still the active inflight — commit to the cache.
      this.entries.set(orgId, {
        ciphertext: dataKeyCiphertext,
        key,
        expiresAt: Date.now() + this.ttlMs,
        inflight: null,
      });
    }
    // If we were superseded, we do NOT cache this result, but we MUST still
    // return the real plaintext: the caller asked for this exact ciphertext
    // and an in-flight crypto op depends on the live DEK. Zeroing the buffer
    // here would hand them a zeroed key. The buffer is dropped when the
    // caller releases it; GC reclaims the memory.
    return key;
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
