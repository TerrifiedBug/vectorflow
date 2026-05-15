import { describe, it, expect, vi, beforeEach } from "vitest";
import { measureClockSkewSeconds } from "../clock-skew";

describe("measureClockSkewSeconds — early return (Codex P2)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  function dateResp(d: Date): Response {
    return new Response(null, {
      status: 200,
      headers: { date: d.toUTCString() },
    });
  }

  it("returns after enough samples have arrived without waiting for the slow one", async () => {
    const now = new Date();
    let resolveSlow: ((r: Response) => void) | null = null as ((r: Response) => void) | null;
    const start = Date.now();
    const skew = await measureClockSkewSeconds({
      sources: ["https://fast1.example", "https://fast2.example", "https://slow.example"],
      timeoutMs: 5000,
      minSamples: 2,
      fetchImpl: (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === "https://slow.example") {
          return new Promise<Response>((res) => {
            resolveSlow = res;
          });
        }
        return Promise.resolve(dateResp(now));
      },
    });
    const elapsed = Date.now() - start;
    // HTTP Date header is second-resolution; allow ±1s precision noise.
    expect(Math.abs(skew)).toBeLessThanOrEqual(1);
    // We must return promptly once 2 samples are in, not wait for slow.
    expect(elapsed).toBeLessThan(1000);
    // Cleanup so the test doesn't leak the hanging promise.
    resolveSlow?.(dateResp(now));
  });

  it("falls back to a single sample when only one source replies (still resolves)", async () => {
    const now = new Date();
    const skew = await measureClockSkewSeconds({
      sources: ["https://a.example", "https://b.example"],
      timeoutMs: 200,
      minSamples: 1,
      fetchImpl: (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === "https://a.example") return Promise.resolve(dateResp(now));
        return new Promise<Response>(() => {}); // hangs
      },
    });
    expect(Math.abs(skew)).toBeLessThanOrEqual(1);
  });
});
