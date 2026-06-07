import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock the Redis client module so MetricStore.getRedis() returns our fake.
vi.mock("@/lib/redis", () => ({ getRedis: vi.fn() }));

import { getRedis } from "@/lib/redis";
import { MetricStore, type MetricSample } from "@/server/services/metric-store";

const REDIS_HASH = "vf:metric-store:latest";
const mockedGetRedis = vi.mocked(getRedis);

function makeSample(overrides: Partial<MetricSample> = {}): MetricSample {
  return {
    timestamp: Date.now(),
    receivedEventsRate: 100,
    sentEventsRate: 95,
    receivedBytesRate: 1000,
    sentBytesRate: 950,
    errorCount: 0,
    errorsRate: 0,
    discardedRate: 0,
    latencyMeanMs: 5,
    ...overrides,
  };
}

// In-memory ioredis stand-in covering the hash ops MetricStore uses. The async
// bodies have no internal await, so map mutations land synchronously when the
// (fire-and-forget) command is invoked — matching how ioredis pipelines locally.
function makeFakeRedis() {
  const hashes = new Map<string, Map<string, string>>();
  return {
    hashes,
    hset: vi.fn(async (h: string, f: string, v: string) => {
      const m = hashes.get(h) ?? new Map<string, string>();
      m.set(f, v);
      hashes.set(h, m);
      return 1;
    }),
    hgetall: vi.fn(async (h: string) =>
      Object.fromEntries(hashes.get(h) ?? new Map<string, string>()),
    ),
    hdel: vi.fn(async (h: string, ...fields: string[]) => {
      const m = hashes.get(h);
      if (!m) return 0;
      let n = 0;
      for (const f of fields) if (m.delete(f)) n++;
      return n;
    }),
  };
}

describe("MetricStore Redis L2 (SC-6)", () => {
  beforeEach(() => {
    mockedGetRedis.mockReset();
  });

  it("mirrors recorded samples to the Redis L2 hash", async () => {
    const fake = makeFakeRedis();
    mockedGetRedis.mockReturnValue(fake as never);
    const store = new MetricStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T12:00:00Z"));

    // First call seeds prevTotals (returns null); the second emits a rate sample.
    store.recordTotals("n1", "p1", "c1", { receivedEventsTotal: 0, sentEventsTotal: 0 });
    vi.advanceTimersByTime(5000);
    const sample = store.recordTotals("n1", "p1", "c1", {
      receivedEventsTotal: 500,
      sentEventsTotal: 480,
    });
    vi.useRealTimers();

    expect(sample).not.toBeNull();
    expect(fake.hset).toHaveBeenCalled();
    const stored = fake.hashes.get(REDIS_HASH)?.get("n1:p1:c1");
    expect(stored).toBeDefined();
    expect(JSON.parse(stored!).receivedEventsRate).toBeGreaterThan(0);
  });

  it("hydrates a cold store from L2 so a restarted instance serves current metrics", async () => {
    const fake = makeFakeRedis();
    mockedGetRedis.mockReturnValue(fake as never);
    // L2 populated before this instance started (another instance / pre-restart).
    fake.hashes.set(
      REDIS_HASH,
      new Map([["n1:p1:c1", JSON.stringify(makeSample({ receivedEventsRate: 42 }))]]),
    );

    const store = new MetricStore(); // cold L1
    expect(store.getSamples("n1", "p1", "c1", 60)).toHaveLength(0);

    expect(await store.hydrateFromRedis()).toBe(1);
    const got = store.getSamples("n1", "p1", "c1", 60);
    expect(got).toHaveLength(1);
    expect(got[0].receivedEventsRate).toBe(42);
  });

  it("is idempotent across repeated hydrate cycles (no duplicates)", async () => {
    const fake = makeFakeRedis();
    mockedGetRedis.mockReturnValue(fake as never);
    fake.hashes.set(
      REDIS_HASH,
      new Map([["n1:p1:c1", JSON.stringify(makeSample())]]),
    );

    const store = new MetricStore();
    expect(await store.hydrateFromRedis()).toBe(1);
    expect(await store.hydrateFromRedis()).toBe(0); // nothing newer
    expect(store.getSamples("n1", "p1", "c1", 999999)).toHaveLength(1);
  });

  it("skips and prunes stale L2 entries", async () => {
    const fake = makeFakeRedis();
    mockedGetRedis.mockReturnValue(fake as never);
    // 1h old — beyond the 10-minute L2 TTL.
    fake.hashes.set(
      REDIS_HASH,
      new Map([["n1:p1:c1", JSON.stringify(makeSample({ timestamp: Date.now() - 60 * 60_000 }))]]),
    );

    const store = new MetricStore();
    expect(await store.hydrateFromRedis()).toBe(0);
    expect(store.getSamples("n1", "p1", "c1", 999999)).toHaveLength(0);
    expect(fake.hdel).toHaveBeenCalledWith(REDIS_HASH, "n1:p1:c1");
  });

  it("does not clobber a fresher local sample", async () => {
    const fake = makeFakeRedis();
    mockedGetRedis.mockReturnValue(fake as never);
    const store = new MetricStore();

    const localTs = Date.now();
    store.mergeSample("n1", "p1", "c1", makeSample({ timestamp: localTs, receivedEventsRate: 999 }));

    // L2 holds an OLDER sample for the same key.
    fake.hashes.set(
      REDIS_HASH,
      new Map([
        ["n1:p1:c1", JSON.stringify(makeSample({ timestamp: localTs - 5000, receivedEventsRate: 1 }))],
      ]),
    );

    expect(await store.hydrateFromRedis()).toBe(0);
    const got = store.getSamples("n1", "p1", "c1", 999999);
    expect(got).toHaveLength(1);
    expect(got[0].receivedEventsRate).toBe(999);
  });

  it("hydrates a component key that itself contains colons", async () => {
    const fake = makeFakeRedis();
    mockedGetRedis.mockReturnValue(fake as never);
    fake.hashes.set(
      REDIS_HASH,
      new Map([["n1:p1:comp:with:colons", JSON.stringify(makeSample({ receivedEventsRate: 7 }))]]),
    );

    const store = new MetricStore();
    expect(await store.hydrateFromRedis()).toBe(1);
    expect(store.getSamples("n1", "p1", "comp:with:colons", 60)).toHaveLength(1);
  });

  it("is a no-op when Redis is not configured", async () => {
    mockedGetRedis.mockReturnValue(null);
    const store = new MetricStore();
    // recordTotals must not throw when mirroring without Redis.
    store.recordTotals("n1", "p1", "c1", { receivedEventsTotal: 0, sentEventsTotal: 0 });
    store.recordTotals("n1", "p1", "c1", { receivedEventsTotal: 10, sentEventsTotal: 9 });
    expect(await store.hydrateFromRedis()).toBe(0);
  });
});
