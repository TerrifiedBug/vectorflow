import { describe, it, expect } from "vitest";
import { getPollingInterval } from "../use-polling-interval";

describe("getPollingInterval", () => {
  it("returns false when SSE is connected (polling suppressed)", () => {
    expect(getPollingInterval("connected", 15_000)).toBe(false);
  });

  it("returns false when connected even with high base interval", () => {
    expect(getPollingInterval("connected", 60_000)).toBe(false);
  });

  it("enforces 30s floor when disconnected and base is below floor", () => {
    expect(getPollingInterval("disconnected", 15_000)).toBe(30_000);
  });

  it("keeps base interval when disconnected and base exceeds floor", () => {
    expect(getPollingInterval("disconnected", 60_000)).toBe(60_000);
  });

  it("enforces 30s floor when reconnecting and base is below floor", () => {
    expect(getPollingInterval("reconnecting", 15_000)).toBe(30_000);
  });

  it("keeps base interval when reconnecting and base exceeds floor", () => {
    expect(getPollingInterval("reconnecting", 45_000)).toBe(45_000);
  });

  it("returns exactly 30s when disconnected with base of 30s", () => {
    expect(getPollingInterval("disconnected", 30_000)).toBe(30_000);
  });

  it("returns exactly 30s when base is 0 and disconnected", () => {
    expect(getPollingInterval("disconnected", 0)).toBe(30_000);
  });
});
