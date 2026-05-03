import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RateLimiter } from "../rate-limiter";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new RateLimiter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the default limit", async () => {
    const result = await limiter.check("sa-1", "default");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
  });

  it("blocks requests exceeding the default limit", async () => {
    for (let i = 0; i < 100; i++) {
      await limiter.check("sa-1", "default");
    }
    const result = await limiter.check("sa-1", "default");
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("uses read tier with 200 req/min limit", async () => {
    for (let i = 0; i < 200; i++) {
      const r = await limiter.check("sa-1", "read");
      expect(r.allowed).toBe(true);
    }
    const result = await limiter.check("sa-1", "read");
    expect(result.allowed).toBe(false);
  });

  it("uses deploy tier with 20 req/min limit", async () => {
    for (let i = 0; i < 20; i++) {
      await limiter.check("sa-1", "deploy");
    }
    const result = await limiter.check("sa-1", "deploy");
    expect(result.allowed).toBe(false);
  });

  it("resets after the window expires", async () => {
    for (let i = 0; i < 100; i++) {
      await limiter.check("sa-1", "default");
    }
    expect((await limiter.check("sa-1", "default")).allowed).toBe(false);

    // Advance past 1-minute window
    vi.advanceTimersByTime(61_000);

    expect((await limiter.check("sa-1", "default")).allowed).toBe(true);
  });

  it("respects custom rate limit override", async () => {
    for (let i = 0; i < 50; i++) {
      await limiter.check("sa-1", "default", 50);
    }
    const result = await limiter.check("sa-1", "default", 50);
    expect(result.allowed).toBe(false);
  });

  it("isolates rate limits between different service accounts", async () => {
    for (let i = 0; i < 100; i++) {
      await limiter.check("sa-1", "default");
    }
    expect((await limiter.check("sa-1", "default")).allowed).toBe(false);
    expect((await limiter.check("sa-2", "default")).allowed).toBe(true);
  });

  it("enforces one shared Redis window across multiple app replicas", async () => {
    const redis = createSharedRedis();
    const replicaA = new RateLimiter({ redis });
    const replicaB = new RateLimiter({ redis });

    expect(await replicaA.checkKey("ip:enroll:203.0.113.10", 3)).toMatchObject({
      allowed: true,
      remaining: 2,
    });
    expect(await replicaB.checkKey("ip:enroll:203.0.113.10", 3)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(await replicaA.checkKey("ip:enroll:203.0.113.10", 3)).toMatchObject({
      allowed: true,
      remaining: 0,
    });

    const blocked = await replicaB.checkKey("ip:enroll:203.0.113.10", 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });
});

function createSharedRedis() {
  const windows = new Map<string, Array<{ score: number; member: string }>>();

  return {
    async eval(
      _script: string,
      _keyCount: number,
      key: string,
      nowArg: string,
      cutoffArg: string,
      limitArg: string,
      _windowMsArg: string,
      member: string,
    ) {
      const now = Number(nowArg);
      const cutoff = Number(cutoffArg);
      const limit = Number(limitArg);
      const window = (windows.get(key) ?? []).filter((entry) => entry.score > cutoff);
      windows.set(key, window);

      if (window.length >= limit) {
        return [0, window.length, window[0]?.score ?? now];
      }

      window.push({ score: now, member });
      window.sort((a, b) => a.score - b.score || a.member.localeCompare(b.member));
      return [1, window.length, 0];
    },
  };
}
