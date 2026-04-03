import { describe, it, expect } from "vitest";
import { appendTapEvents, type TapEventEntry } from "../use-live-tap";

describe("use-live-tap helpers", () => {
  it("appends events and caps buffer at maxSize", () => {
    const existing: TapEventEntry[] = Array.from({ length: 95 }, (_, i) => ({
      id: `old-${i}`,
      data: { index: i },
    }));
    const newEvents: TapEventEntry[] = Array.from({ length: 10 }, (_, i) => ({
      id: `new-${i}`,
      data: { index: 100 + i },
    }));
    const result = appendTapEvents(existing, newEvents, 100);
    expect(result).toHaveLength(100);
    // Newest should be first
    expect(result[0].id).toBe("new-9");
    expect(result[9].id).toBe("new-0");
  });

  it("returns empty array when no events", () => {
    const result = appendTapEvents([], [], 100);
    expect(result).toHaveLength(0);
  });

  it("returns existing unchanged when no incoming", () => {
    const existing = [{ id: "a", data: 1 }];
    const result = appendTapEvents(existing, [], 100);
    expect(result).toBe(existing); // same reference
  });
});
