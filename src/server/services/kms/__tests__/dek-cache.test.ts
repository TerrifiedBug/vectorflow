import { describe, it, expect, beforeEach, vi } from "vitest";
import { DekCache } from "../dek-cache";
import { LocalDevKmsProvider } from "../local-dev";

describe("DekCache", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "test-secret-for-dek-cache-only-not-prod";
    vi.useFakeTimers();
  });

  it("caches a DEK after first unwrap", async () => {
    const kms = new LocalDevKmsProvider();
    const { ciphertext } = await kms.generateDataKey("org-a");
    const spy = vi.spyOn(kms, "unwrapDataKey");
    const cache = new DekCache(kms, { ttlMs: 5_000 });

    const k1 = await cache.get("org-a", ciphertext);
    const k2 = await cache.get("org-a", ciphertext);

    expect(k1.equals(k2)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("evicts after TTL", async () => {
    const kms = new LocalDevKmsProvider();
    const { ciphertext } = await kms.generateDataKey("org-a");
    const spy = vi.spyOn(kms, "unwrapDataKey");
    const cache = new DekCache(kms, { ttlMs: 5_000 });

    await cache.get("org-a", ciphertext);
    vi.advanceTimersByTime(5_001);
    await cache.get("org-a", ciphertext);

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("evicts the cached buffer on invalidate (zeroing)", async () => {
    const kms = new LocalDevKmsProvider();
    const { ciphertext } = await kms.generateDataKey("org-a");
    const cache = new DekCache(kms, { ttlMs: 5_000 });

    const key = await cache.get("org-a", ciphertext);
    const observedSlice = Buffer.from(key); // copy before zeroing
    cache.invalidate("org-a");

    // After invalidation, the cached underlying buffer is zeroed.
    // The previously-returned reference is the cached buffer, so it is zeroed in place.
    expect(key.equals(Buffer.alloc(32, 0))).toBe(true);
    // Sanity: it was non-zero before invalidation
    expect(observedSlice.equals(Buffer.alloc(32, 0))).toBe(false);
  });

  it("invalidateAll zeroes all entries", async () => {
    const kms = new LocalDevKmsProvider();
    const { ciphertext: ca } = await kms.generateDataKey("org-a");
    const { ciphertext: cb } = await kms.generateDataKey("org-b");
    const cache = new DekCache(kms, { ttlMs: 5_000 });

    const ka = await cache.get("org-a", ca);
    const kb = await cache.get("org-b", cb);
    cache.invalidateAll();

    expect(ka.equals(Buffer.alloc(32, 0))).toBe(true);
    expect(kb.equals(Buffer.alloc(32, 0))).toBe(true);
  });

  it("warm() pre-populates the cache", async () => {
    const kms = new LocalDevKmsProvider();
    const { ciphertext: ca } = await kms.generateDataKey("org-a");
    const { ciphertext: cb } = await kms.generateDataKey("org-b");
    const spy = vi.spyOn(kms, "unwrapDataKey");
    const cache = new DekCache(kms, { ttlMs: 5_000 });

    await cache.warm([
      { orgId: "org-a", dataKeyCiphertext: ca },
      { orgId: "org-b", dataKeyCiphertext: cb },
    ]);
    expect(spy).toHaveBeenCalledTimes(2);

    // Subsequent gets must be cache hits
    await cache.get("org-a", ca);
    await cache.get("org-b", cb);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent get() for the same org (single-flight)", async () => {
    const kms = new LocalDevKmsProvider();
    const { ciphertext } = await kms.generateDataKey("org-a");
    const spy = vi.spyOn(kms, "unwrapDataKey");
    const cache = new DekCache(kms, { ttlMs: 5_000 });

    const [a, b, c] = await Promise.all([
      cache.get("org-a", ciphertext),
      cache.get("org-a", ciphertext),
      cache.get("org-a", ciphertext),
    ]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(a.equals(b)).toBe(true);
    expect(b.equals(c)).toBe(true);
  });
});
