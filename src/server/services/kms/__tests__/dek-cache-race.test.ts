import { describe, it, expect, beforeEach } from "vitest";
import { DekCache } from "../dek-cache";
import type { KmsProvider } from "../types";

describe("DekCache — rotation race (Codex P1 follow-up)", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "race-test-secret-not-prod";
  });

  function controllableKms(): {
    kms: KmsProvider;
    resolve: (ct: string, plaintext: Buffer) => void;
    reject: (ct: string, err: Error) => void;
  } {
    const pending = new Map<string, { resolve: (b: Buffer) => void; reject: (e: Error) => void }>();
    const kms: KmsProvider = {
      generateDataKey: async () => ({
        plaintext: Buffer.alloc(32),
        ciphertext: "",
      }),
      unwrapDataKey: (ciphertext: string) =>
        new Promise<Buffer>((res, rej) => {
          pending.set(ciphertext, { resolve: res, reject: rej });
        }),
      rewrapDataKey: async () => "",
      describeKey: () => ({ provider: "local-dev", keyId: "test" }),
    };
    return {
      kms,
      resolve(ct: string, plaintext: Buffer) {
        const p = pending.get(ct);
        if (!p) throw new Error(`no pending unwrap for ${ct}`);
        p.resolve(plaintext);
        pending.delete(ct);
      },
      reject(ct: string, err: Error) {
        const p = pending.get(ct);
        if (!p) throw new Error(`no pending unwrap for ${ct}`);
        p.reject(err);
        pending.delete(ct);
      },
    };
  }

  it("stale unwrap resolving AFTER a newer ciphertext does not overwrite the fresh entry", async () => {
    const { kms, resolve } = controllableKms();
    const cache = new DekCache(kms, { ttlMs: 60_000 });

    const pt1 = Buffer.alloc(32, 0xaa);
    const pt2 = Buffer.alloc(32, 0xbb);

    // Kick off both unwraps concurrently
    const p1 = cache.get("org-a", "ct-old");
    const p2 = cache.get("org-a", "ct-new");

    // Resolve the NEW one first
    resolve("ct-new", pt2);
    const r2 = await p2;
    expect(r2.equals(pt2)).toBe(true);

    // Now the stale OLD unwrap resolves — it MUST NOT clobber ct-new in the
    // cache, AND the caller that asked for ct-old MUST still receive the
    // real ct-old plaintext (not a zeroed buffer).
    resolve("ct-old", pt1);
    const r1 = await p1;
    expect(r1.equals(pt1)).toBe(true);

    // A subsequent get for the new ciphertext returns pt2 from cache without a new unwrap
    const r2again = await cache.get("org-a", "ct-new");
    expect(r2again.equals(pt2)).toBe(true);
  });

  it("rejecting a stale unwrap does not poison the new entry", async () => {
    const { kms, resolve, reject } = controllableKms();
    const cache = new DekCache(kms, { ttlMs: 60_000 });

    const pt2 = Buffer.alloc(32, 0xbb);
    const p1 = cache.get("org-a", "ct-old");
    const p2 = cache.get("org-a", "ct-new");
    resolve("ct-new", pt2);
    await p2;

    // Stale unwrap fails — must not evict the good entry
    reject("ct-old", new Error("stale"));
    await p1.catch(() => undefined);

    const r = await cache.get("org-a", "ct-new");
    expect(r.equals(pt2)).toBe(true);
  });
});
