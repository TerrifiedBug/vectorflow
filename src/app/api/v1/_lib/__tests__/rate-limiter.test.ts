import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RateLimiter, type RateLimitTier } from "../rate-limiter";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new RateLimiter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the default limit", () => {
    const result = limiter.check("sa-1", "default");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
  });

  it("blocks requests exceeding the default limit", () => {
    for (let i = 0; i < 100; i++) {
      limiter.check("sa-1", "default");
    }
    const result = limiter.check("sa-1", "default");
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("uses read tier with 200 req/min limit", () => {
    for (let i = 0; i < 200; i++) {
      const r = limiter.check("sa-1", "read");
      expect(r.allowed).toBe(true);
    }
    const result = limiter.check("sa-1", "read");
    expect(result.allowed).toBe(false);
  });

  it("uses deploy tier with 20 req/min limit", () => {
    for (let i = 0; i < 20; i++) {
      limiter.check("sa-1", "deploy");
    }
    const result = limiter.check("sa-1", "deploy");
    expect(result.allowed).toBe(false);
  });

  it("resets after the window expires", () => {
    for (let i = 0; i < 100; i++) {
      limiter.check("sa-1", "default");
    }
    expect(limiter.check("sa-1", "default").allowed).toBe(false);

    // Advance past 1-minute window
    vi.advanceTimersByTime(61_000);

    expect(limiter.check("sa-1", "default").allowed).toBe(true);
  });

  it("respects custom rate limit override", () => {
    for (let i = 0; i < 50; i++) {
      limiter.check("sa-1", "default", 50);
    }
    const result = limiter.check("sa-1", "default", 50);
    expect(result.allowed).toBe(false);
  });

  it("isolates rate limits between different service accounts", () => {
    for (let i = 0; i < 100; i++) {
      limiter.check("sa-1", "default");
    }
    expect(limiter.check("sa-1", "default").allowed).toBe(false);
    expect(limiter.check("sa-2", "default").allowed).toBe(true);
  });
});
