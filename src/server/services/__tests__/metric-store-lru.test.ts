import { vi, describe, it, expect, afterEach } from "vitest";
import { MetricStore } from "@/server/services/metric-store";

describe("MetricStore LRU eviction", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("evicts least-recently-updated streams when maxKeys is exceeded", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T00:00:00Z"));

    const store = new MetricStore({ maxKeys: 3 });

    // Seed 3 streams
    const seedStream = (comp: string) => {
      store.recordTotals("n1", "p1", comp, {
        receivedEventsTotal: 0,
        sentEventsTotal: 0,
      });
      vi.advanceTimersByTime(5000);
      store.recordTotals("n1", "p1", comp, {
        receivedEventsTotal: 100,
        sentEventsTotal: 90,
      });
    };

    seedStream("comp-a");
    vi.advanceTimersByTime(1000);
    seedStream("comp-b");
    vi.advanceTimersByTime(1000);
    seedStream("comp-c");

    // All 3 should exist
    expect(store.getStreamCount()).toBe(3);

    // Adding a 4th should evict the oldest (comp-a)
    vi.advanceTimersByTime(1000);
    seedStream("comp-d");

    expect(store.getStreamCount()).toBe(3);
    expect(store.getSamples("n1", "p1", "comp-a")).toHaveLength(0);
    expect(store.getSamples("n1", "p1", "comp-d").length).toBeGreaterThan(0);
  });

  it("reports estimated memory usage", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T00:00:00Z"));

    const store = new MetricStore({ maxKeys: 100 });

    store.recordTotals("n1", "p1", "comp-a", {
      receivedEventsTotal: 0,
      sentEventsTotal: 0,
    });
    vi.advanceTimersByTime(5000);
    store.recordTotals("n1", "p1", "comp-a", {
      receivedEventsTotal: 100,
      sentEventsTotal: 90,
    });

    const mem = store.getEstimatedMemoryBytes();
    expect(mem).toBeGreaterThan(0);
  });

  it("logs warning when approaching 80% capacity", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T00:00:00Z"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const store = new MetricStore({ maxKeys: 5 });

    // Fill to 80% = 4 streams
    for (let i = 0; i < 4; i++) {
      store.recordTotals("n1", "p1", `comp-${i}`, {
        receivedEventsTotal: 0,
        sentEventsTotal: 0,
      });
      vi.advanceTimersByTime(5000);
      store.recordTotals("n1", "p1", `comp-${i}`, {
        receivedEventsTotal: 100,
        sentEventsTotal: 90,
      });
      vi.advanceTimersByTime(1000);
    }

    expect(warnSpy).toHaveBeenCalledWith(
      "%s [%s] %s",
      expect.any(String),
      "metric-store",
      expect.stringContaining("80%"),
    );

    warnSpy.mockRestore();
  });
});
