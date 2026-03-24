import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkRateLimit } from "../rate-limiter";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows first call with remaining = maxRequests - 1", () => {
    const result = checkRateLimit("team-1");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(59); // default 60 - 1
  });

  it("depletes tokens after repeated calls", () => {
    const maxRequests = 3;
    checkRateLimit("team-deplete", maxRequests);
    checkRateLimit("team-deplete", maxRequests);
    checkRateLimit("team-deplete", maxRequests);
    const result = checkRateLimit("team-deplete", maxRequests);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("refills tokens after window elapses", () => {
    const maxRequests = 2;
    checkRateLimit("team-refill", maxRequests);
    checkRateLimit("team-refill", maxRequests);
    // Now tokens are depleted
    expect(checkRateLimit("team-refill", maxRequests).allowed).toBe(false);

    // Advance past the 1-hour window
    vi.advanceTimersByTime(60 * 60 * 1000);

    const result = checkRateLimit("team-refill", maxRequests);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1); // maxRequests - 1
  });

  it("maintains independent buckets per teamId", () => {
    const maxRequests = 1;
    checkRateLimit("team-a", maxRequests);
    expect(checkRateLimit("team-a", maxRequests).allowed).toBe(false);
    // Different team should still have tokens
    expect(checkRateLimit("team-b", maxRequests).allowed).toBe(true);
  });

  it("respects custom maxRequests parameter", () => {
    const result = checkRateLimit("team-custom", 100);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
  });
});
