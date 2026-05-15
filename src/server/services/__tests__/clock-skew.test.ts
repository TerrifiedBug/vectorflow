import { describe, it, expect, vi, beforeEach } from "vitest";
import { measureClockSkewSeconds } from "../clock-skew";

describe("measureClockSkewSeconds", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  function fakeResponse(dateHeader: string): Response {
    const headers = new Headers({ date: dateHeader });
    return new Response(null, { status: 200, headers });
  }

  it("returns 0 when local clock matches every source", async () => {
    const now = new Date("2026-05-16T12:00:00Z");
    vi.setSystemTime(now);
    const skew = await measureClockSkewSeconds({
      sources: ["https://a.example", "https://b.example"],
      fetchImpl: async () => fakeResponse(now.toUTCString()),
    });
    expect(skew).toBe(0);
  });

  it("returns the median skew across sources, ignoring outliers", async () => {
    const now = new Date("2026-05-16T12:00:00Z");
    vi.setSystemTime(now);
    const skews: Record<string, number> = {
      "https://a.example": 1,    // 1s ahead
      "https://b.example": 2,    // 2s ahead
      "https://c.example": 30,   // outlier — wildly ahead
    };
    const skew = await measureClockSkewSeconds({
      sources: Object.keys(skews),
      fetchImpl: async (url) => {
        const s = skews[url];
        const t = new Date(now.getTime() + s * 1000);
        return fakeResponse(t.toUTCString());
      },
    });
    // Median of [1, 2, 30] = 2
    expect(skew).toBe(2);
  });

  it("treats failures as missing samples and still returns median of successes", async () => {
    const now = new Date("2026-05-16T12:00:00Z");
    vi.setSystemTime(now);
    const skew = await measureClockSkewSeconds({
      sources: ["https://a.example", "https://b.example", "https://c.example"],
      fetchImpl: async (url) => {
        if (url === "https://b.example") {
          throw new Error("network");
        }
        const ahead = url === "https://a.example" ? 1 : 3;
        const t = new Date(now.getTime() + ahead * 1000);
        return fakeResponse(t.toUTCString());
      },
    });
    // Median of [1, 3] = 2
    expect(skew).toBe(2);
  });

  it("throws when every source fails", async () => {
    await expect(
      measureClockSkewSeconds({
        sources: ["https://a.example", "https://b.example"],
        fetchImpl: async () => {
          throw new Error("offline");
        },
      }),
    ).rejects.toThrow(/no clock sources/i);
  });

  it("respects per-source timeout (treats slow responses as failures)", async () => {
    const now = new Date("2026-05-16T12:00:00Z");
    vi.setSystemTime(now);
    const skewPromise = measureClockSkewSeconds({
      sources: ["https://a.example", "https://b.example"],
      timeoutMs: 100,
      fetchImpl: (url, init) => {
        if (url === "https://a.example") {
          // hang until aborted
          return new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          });
        }
        return Promise.resolve(fakeResponse(now.toUTCString()));
      },
    });
    // Advance fake timers so the AbortController fires.
    await vi.advanceTimersByTimeAsync(200);
    // a aborted → only b reports 0
    expect(await skewPromise).toBe(0);
  });
});
