import { describe, it, expect, vi, beforeEach } from "vitest";
import { DekCache } from "../dek-cache";
import { LocalDevKmsProvider } from "../local-dev";

describe("DekCache — DEK rotation safety (Codex P1)", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "rotation-test-secret-not-prod";
    delete process.env.VF_LOCAL_KMS_KEY;
  });

  it("invalidates the cached DEK when a new dataKeyCiphertext is supplied", async () => {
    const kms = new LocalDevKmsProvider();
    const { plaintext: pt1, ciphertext: ct1 } = await kms.generateDataKey("org-a");
    const { plaintext: pt2, ciphertext: ct2 } = await kms.generateDataKey("org-a");
    expect(pt1.equals(pt2)).toBe(false); // different DEKs

    const spy = vi.spyOn(kms, "unwrapDataKey");
    const cache = new DekCache(kms, { ttlMs: 60_000 });

    const k1 = await cache.get("org-a", ct1);
    expect(k1.equals(pt1)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);

    // Caller rotates: org's stored ciphertext changes to ct2. The cache MUST
    // unwrap freshly rather than serve the stale pt1.
    const k2 = await cache.get("org-a", ct2);
    expect(k2.equals(pt2)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);

    // Subsequent gets with ct2 are cache hits.
    await cache.get("org-a", ct2);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("single-flight: concurrent gets with the SAME ciphertext share one unwrap", async () => {
    const kms = new LocalDevKmsProvider();
    const { ciphertext } = await kms.generateDataKey("org-a");
    const spy = vi.spyOn(kms, "unwrapDataKey");
    const cache = new DekCache(kms, { ttlMs: 60_000 });

    await Promise.all([
      cache.get("org-a", ciphertext),
      cache.get("org-a", ciphertext),
      cache.get("org-a", ciphertext),
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("invalidate zeroes the cached buffer", async () => {
    const kms = new LocalDevKmsProvider();
    const { ciphertext } = await kms.generateDataKey("org-a");
    const cache = new DekCache(kms, { ttlMs: 60_000 });

    const k = await cache.get("org-a", ciphertext);
    const beforeZero = Buffer.from(k);
    cache.invalidate("org-a");
    expect(k.equals(Buffer.alloc(32, 0))).toBe(true);
    expect(beforeZero.equals(Buffer.alloc(32, 0))).toBe(false);
  });
});
