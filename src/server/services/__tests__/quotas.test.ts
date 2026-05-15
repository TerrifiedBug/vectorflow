import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  orgFindUnique: vi.fn(),
  vectorNodeCount: vi.fn(),
  pipelineCount: vi.fn(),
  environmentCount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: mocks.orgFindUnique },
    vectorNode: { count: mocks.vectorNodeCount },
    pipeline: { count: mocks.pipelineCount },
    environment: { count: mocks.environmentCount },
  },
}));

import {
  PLAN_QUOTAS,
  checkQuota,
  enforceQuota,
  QuotaExceededError,
} from "../quotas";

describe("PLAN_QUOTAS", () => {
  it("FREE < PRO < ENTERPRISE on every numeric quota", () => {
    for (const k of ["agents", "pipelines", "environments"] as const) {
      expect(PLAN_QUOTAS.FREE[k]).toBeLessThan(PLAN_QUOTAS.PRO[k]);
      expect(PLAN_QUOTAS.PRO[k]).toBeLessThanOrEqual(PLAN_QUOTAS.ENTERPRISE[k]);
    }
  });

  it("ENTERPRISE has Infinity quotas for unlimited tiers", () => {
    expect(PLAN_QUOTAS.ENTERPRISE.agents).toBe(Infinity);
  });
});

describe("checkQuota", () => {
  beforeEach(() => {
    mocks.orgFindUnique.mockReset();
    mocks.vectorNodeCount.mockReset();
    mocks.pipelineCount.mockReset();
    mocks.environmentCount.mockReset();
  });

  it("returns allowed=true when current < limit", async () => {
    mocks.orgFindUnique.mockResolvedValue({ id: "org-a", plan: "FREE" });
    mocks.vectorNodeCount.mockResolvedValue(3);
    const r = await checkQuota("org-a", "agents");
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(PLAN_QUOTAS.FREE.agents);
    expect(r.current).toBe(3);
  });

  it("returns allowed=false when current == limit (no off-by-one)", async () => {
    mocks.orgFindUnique.mockResolvedValue({ id: "org-a", plan: "FREE" });
    mocks.vectorNodeCount.mockResolvedValue(PLAN_QUOTAS.FREE.agents);
    const r = await checkQuota("org-a", "agents");
    expect(r.allowed).toBe(false);
    expect(r.current).toBe(PLAN_QUOTAS.FREE.agents);
  });

  it("returns allowed=false when current > limit", async () => {
    mocks.orgFindUnique.mockResolvedValue({ id: "org-a", plan: "FREE" });
    mocks.vectorNodeCount.mockResolvedValue(PLAN_QUOTAS.FREE.agents + 1);
    const r = await checkQuota("org-a", "agents");
    expect(r.allowed).toBe(false);
  });

  it("ENTERPRISE never exceeds quota (Infinity)", async () => {
    mocks.orgFindUnique.mockResolvedValue({ id: "org-a", plan: "ENTERPRISE" });
    mocks.vectorNodeCount.mockResolvedValue(10_000_000);
    const r = await checkQuota("org-a", "agents");
    expect(r.allowed).toBe(true);
  });

  it("scopes the count query to the org", async () => {
    mocks.orgFindUnique.mockResolvedValue({ id: "org-a", plan: "PRO" });
    mocks.vectorNodeCount.mockResolvedValue(5);
    await checkQuota("org-a", "agents");
    expect(mocks.vectorNodeCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-a" }) }),
    );
  });

  it("uses environment count for environments quota", async () => {
    mocks.orgFindUnique.mockResolvedValue({ id: "org-a", plan: "PRO" });
    mocks.environmentCount.mockResolvedValue(2);
    const r = await checkQuota("org-a", "environments");
    expect(r.current).toBe(2);
    expect(mocks.environmentCount).toHaveBeenCalled();
  });

  it("uses pipeline count for pipelines quota", async () => {
    mocks.orgFindUnique.mockResolvedValue({ id: "org-a", plan: "PRO" });
    mocks.pipelineCount.mockResolvedValue(7);
    const r = await checkQuota("org-a", "pipelines");
    expect(r.current).toBe(7);
    expect(mocks.pipelineCount).toHaveBeenCalled();
  });

  it("throws when the org row does not exist (cannot derive plan)", async () => {
    mocks.orgFindUnique.mockResolvedValue(null);
    await expect(checkQuota("org-missing", "agents")).rejects.toThrow(/not found/i);
  });
});

describe("enforceQuota", () => {
  beforeEach(() => {
    mocks.orgFindUnique.mockReset();
    mocks.vectorNodeCount.mockReset();
  });

  it("returns void when allowed", async () => {
    mocks.orgFindUnique.mockResolvedValue({ id: "org-a", plan: "FREE" });
    mocks.vectorNodeCount.mockResolvedValue(1);
    await expect(enforceQuota("org-a", "agents")).resolves.toBeUndefined();
  });

  it("throws QuotaExceededError with structured shape when exceeded", async () => {
    mocks.orgFindUnique.mockResolvedValue({ id: "org-a", plan: "FREE" });
    mocks.vectorNodeCount.mockResolvedValue(PLAN_QUOTAS.FREE.agents);
    try {
      await enforceQuota("org-a", "agents");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExceededError);
      const qe = err as QuotaExceededError;
      expect(qe.quota).toBe("agents");
      expect(qe.organizationId).toBe("org-a");
      expect(qe.plan).toBe("FREE");
      expect(qe.limit).toBe(PLAN_QUOTAS.FREE.agents);
      expect(qe.current).toBeGreaterThanOrEqual(qe.limit);
    }
  });
});
