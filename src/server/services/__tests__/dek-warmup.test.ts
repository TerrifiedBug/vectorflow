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

  it("chunks at the supplied parallelism boundary", async () => {
    const chunkSizes: number[] = [];
    const orgs = Array.from({ length: 10 }, (_, i) => ({
      id: `org-${i}`,
      dataKeyCiphertext: `ct-${i}`,
    }));

    await warmDekCacheForActiveOrgs({
      listOrgs: async () => orgs,
      cache: {
        warm: async (entries) => {
          chunkSizes.push(entries.length);
        },
      },
      parallelism: 4,
    });

    // 10 orgs, chunks of 4 -> [4, 4, 2]
    expect(chunkSizes).toEqual([4, 4, 2]);
  });

  it("tolerates per-chunk failures without aborting", async () => {
    const orgs = Array.from({ length: 6 }, (_, i) => ({
      id: `org-${i}`,
      dataKeyCiphertext: `ct-${i}`,
    }));
    let chunkN = 0;

    const result = await warmDekCacheForActiveOrgs({
      listOrgs: async () => orgs,
      cache: {
        warm: async () => {
          chunkN++;
          if (chunkN === 2) throw new Error("KMS hiccup");
        },
      },
      parallelism: 3,
    });

    // 6 orgs, chunks of 3: chunk 1 succeeds, chunk 2 fails.
    expect(result.attempted).toBe(6);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(3);
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
