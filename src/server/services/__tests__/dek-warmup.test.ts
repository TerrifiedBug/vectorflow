import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  infoLog: vi.fn(),
  warnLog: vi.fn(),
  errorLog: vi.fn(),
}));

import { warmDekCacheForActiveOrgs } from "../dek-warmup";

describe("warmDekCacheForActiveOrgs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("warms every active org with a dataKeyCiphertext", async () => {
    const warmed: Array<{ orgId: string; dataKeyCiphertext: string }> = [];
    const orgs = [
      { id: "a", dataKeyCiphertext: "ct-a" },
      { id: "b", dataKeyCiphertext: "ct-b" },
      { id: "c", dataKeyCiphertext: "ct-c" },
    ];
    const result = await warmDekCacheForActiveOrgs({
      listOrgs: async () => orgs,
      cache: {
        warm: async (entries) => {
          warmed.push(...entries);
        },
      },
      parallelism: 8,
    });

    expect(result.attempted).toBe(3);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    expect(warmed.map((w) => w.orgId).sort()).toEqual(["a", "b", "c"]);
  });

  it("skips orgs with a null dataKeyCiphertext (OSS-only deployments)", async () => {
    const warmed: Array<{ orgId: string; dataKeyCiphertext: string }> = [];
    const result = await warmDekCacheForActiveOrgs({
      listOrgs: async () => [
        { id: "a", dataKeyCiphertext: "ct-a" },
        { id: "b", dataKeyCiphertext: null },
        { id: "c", dataKeyCiphertext: "ct-c" },
        { id: "d", dataKeyCiphertext: null },
      ],
      cache: {
        warm: async (entries) => {
          warmed.push(...entries);
        },
      },
    });
    expect(result.attempted).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(warmed.map((w) => w.orgId).sort()).toEqual(["a", "c"]);
  });

  it("calls warm once per entry for accurate per-entry outcome tracking", async () => {
    // Each org gets its own warm([entry]) call so rejection surfaces per-entry
    // rather than silently counting whole-batch failures as successes.
    const callArgs: Array<{ orgId: string }[]> = [];
    const orgs = Array.from({ length: 10 }, (_, i) => ({
      id: `org-${i}`,
      dataKeyCiphertext: `ct-${i}`,
    }));

    const result = await warmDekCacheForActiveOrgs({
      listOrgs: async () => orgs,
      cache: {
        warm: async (entries) => {
          callArgs.push(entries.map((e) => ({ orgId: e.orgId })));
        },
      },
      parallelism: 4,
    });

    // warm is called once per org (10 total), each with a single-entry array.
    expect(callArgs).toHaveLength(10);
    expect(callArgs.every((a) => a.length === 1)).toBe(true);
    expect(callArgs.map((a) => a[0]!.orgId).sort()).toEqual(
      orgs.map((o) => o.id).sort(),
    );
    expect(result.attempted).toBe(10);
    expect(result.succeeded).toBe(10);
    expect(result.failed).toBe(0);
  });

  it("tolerates per-entry failures without aborting and counts accurately", async () => {
    // Each entry is warmed individually. The 2nd warm call fails (1 entry
    // fails). The remaining 5 succeed. Succeeded + failed = attempted.
    const orgs = Array.from({ length: 6 }, (_, i) => ({
      id: `org-${i}`,
      dataKeyCiphertext: `ct-${i}`,
    }));
    let callN = 0;

    const result = await warmDekCacheForActiveOrgs({
      listOrgs: async () => orgs,
      cache: {
        warm: async () => {
          callN++;
          if (callN === 2) throw new Error("KMS hiccup on org-1");
        },
      },
      parallelism: 3,
    });

    // 6 orgs warmed individually; the 2nd call fails → failed=1, succeeded=5.
    expect(result.attempted).toBe(6);
    expect(result.succeeded).toBe(5);
    expect(result.failed).toBe(1);
  });

  it("returns immediately with zero counts when no orgs exist", async () => {
    const result = await warmDekCacheForActiveOrgs({
      listOrgs: async () => [],
      cache: { warm: async () => undefined },
    });
    expect(result.attempted).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("reports duration in milliseconds", async () => {
    const result = await warmDekCacheForActiveOrgs({
      listOrgs: async () => [{ id: "a", dataKeyCiphertext: "ct-a" }],
      cache: {
        warm: async () => {
          // small async tick so durationMs is non-zero in most envs
          await new Promise((r) => setTimeout(r, 1));
        },
      },
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
