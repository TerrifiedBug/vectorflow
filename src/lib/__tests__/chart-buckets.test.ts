import { describe, expect, it } from "vitest";

import { bucketMsForMinutes, rangeToMinutes } from "@/lib/chart-buckets";

describe("bucketMsForMinutes", () => {
  it.each([
    [1, 15_000],
    [5, 15_000],
    [6, 30_000],
    [15, 30_000],
    [16, 2 * 60_000],
    [60, 2 * 60_000],
    [61, 5 * 60_000],
    [360, 5 * 60_000],
    [361, 15 * 60_000],
    [1440, 15 * 60_000],
    [1441, 60 * 60_000],
    [10080, 60 * 60_000],
    [10081, 4 * 60 * 60_000],
  ])("maps %i minutes to %i ms", (minutes, expectedBucketMs) => {
    expect(bucketMsForMinutes(minutes)).toBe(expectedBucketMs);
  });
});

describe("rangeToMinutes", () => {
  it.each([
    ["1h", 60],
    ["6h", 360],
    ["1d", 1440],
    ["7d", 10080],
    ["30d", 43200],
    ["unknown", 1440],
  ])("maps %s to %i minutes", (range, expectedMinutes) => {
    expect(rangeToMinutes(range)).toBe(expectedMinutes);
  });
});
