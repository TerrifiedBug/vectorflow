import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  checkKey: vi.fn(),
}));

vi.mock("@/app/api/v1/_lib/rate-limiter", () => ({
  rateLimiter: { checkKey: mocks.checkKey },
}));

import {
  checkOrgRateLimit,
  ORG_RATE_LIMITS,
} from "../org-rate-limit";

describe("checkOrgRateLimit", () => {
  beforeEach(() => {
    mocks.checkKey.mockReset();
  });

  it("returns null when under the limit", async () => {
    mocks.checkKey.mockResolvedValue({ allowed: true, remaining: 99, retryAfter: 0 });
    const r = await checkOrgRateLimit("org-a", "agent");
    expect(r).toBeNull();
  });

  it("returns 429 with Retry-After when limit is exceeded", async () => {
    mocks.checkKey.mockResolvedValue({ allowed: false, remaining: 0, retryAfter: 42 });
    const r = await checkOrgRateLimit("org-a", "agent");
    expect(r).not.toBeNull();
    expect(r!.status).toBe(429);
    expect(r!.headers.get("Retry-After")).toBe("42");
  });

  it("scopes the rate-limit key by org AND endpoint (one tenant cannot starve another)", async () => {
    mocks.checkKey.mockResolvedValue({ allowed: true, remaining: 99, retryAfter: 0 });
    await checkOrgRateLimit("org-a", "agent");
    await checkOrgRateLimit("org-b", "agent");
    await checkOrgRateLimit("org-a", "trpc");
    const keys = mocks.checkKey.mock.calls.map((c) => c[0] as string);
    // Each (org, endpoint) pair is its own bucket
    expect(new Set(keys).size).toBe(3);
    for (const key of keys) {
      expect(key).toMatch(/^org:/);
    }
  });

  it("applies the per-endpoint default limit from ORG_RATE_LIMITS", async () => {
    mocks.checkKey.mockResolvedValue({ allowed: true, remaining: 1, retryAfter: 0 });
    await checkOrgRateLimit("org-a", "agent");
    const [, limit] = mocks.checkKey.mock.calls[0];
    expect(limit).toBe(ORG_RATE_LIMITS.agent);
  });

  it("allows callers to override the limit", async () => {
    mocks.checkKey.mockResolvedValue({ allowed: true, remaining: 1, retryAfter: 0 });
    await checkOrgRateLimit("org-a", "agent", 99);
    expect(mocks.checkKey.mock.calls[0][1]).toBe(99);
  });

  it("default limits match the plan §10 figures", () => {
    expect(ORG_RATE_LIMITS.trpc).toBe(1000);
    expect(ORG_RATE_LIMITS.agent).toBe(6000);
    expect(ORG_RATE_LIMITS.ai).toBe(60);
    expect(ORG_RATE_LIMITS["git-sync"]).toBe(120);
  });

  it("response body declares the per-org scope (for client diagnostics)", async () => {
    mocks.checkKey.mockResolvedValue({ allowed: false, remaining: 0, retryAfter: 5 });
    const r = await checkOrgRateLimit("org-a", "agent");
    const body = await r!.json();
    expect(body.error).toMatch(/rate.?limit/i);
    expect(body.scope).toBe("organization");
  });

  it("orgId is validated as a plain identifier (no key-injection via colons / spaces)", async () => {
    mocks.checkKey.mockResolvedValue({ allowed: true, remaining: 99, retryAfter: 0 });
    await expect(
      checkOrgRateLimit("org:evil:trpc:1000000", "agent"),
    ).rejects.toThrow(/orgId/);
  });
});
