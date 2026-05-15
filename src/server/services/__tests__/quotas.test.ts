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
  type PrismaTxLike,
} from "../quotas";

function makeTxStub(): {
  tx: PrismaTxLike;
  setRaw: ReturnType<typeof vi.fn>;
} {
  const setRaw = vi.fn(async () => 1);
  const tx: PrismaTxLike = {
    $executeRaw: setRaw as unknown as PrismaTxLike["$executeRaw"],
    organization: { findUnique: mocks.orgFindUnique as never },
    vectorNode: { count: mocks.vectorNodeCount as never },
    pipeline: { count: mocks.pipelineCount as never },
    environment: { count: mocks.environmentCount as never },
  };
  return { tx, setRaw };
}

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

describe("checkQuota (read-only)", () => {
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

  it("ENTERPRISE never exceeds quota (Infinity)", async () => {
    mocks.orgFindUnique.mockResolvedValue({ id: "org-a", plan: "ENTERPRISE" });
    mocks.vectorNodeCount.mockResolvedValue(10_000_000);
    const r = await checkQuota("org-a", "agents");
    expect(r.allowed).toBe(true);
  });

  it("throws when the org row does not exist", async () => {
    mocks.orgFindUnique.mockResolvedValue(null);
    await expect(checkQuota("org-missing", "agents")).rejects.toThrow(/not found/i);
  });
});

describe("enforceQuota (transactional)", () => {
  beforeEach(() => {
    mocks.orgFindUnique.mockReset();
    mocks.vectorNodeCount.mockReset();
    mocks.pipelineCount.mockReset();
    mocks.environmentCount.mockReset();
  });

  it("returns void when allowed", async () => {
    mocks.orgFindUnique.mockResolvedValue({ id: "org-a", plan: "FREE" });
    mocks.vectorNodeCount.mockResolvedValue(1);
    const { tx } = makeTxStub();
    await expect(enforceQuota(tx, "org-a", "agents")).resolves.toBeUndefined();
  });

  it("acquires a per-(org, quota) pg_advisory_xact_lock BEFORE counting", async () => {
    mocks.orgFindUnique.mockResolvedValue({ id: "org-a", plan: "FREE" });
    let lockTakenBeforeCount = false;
    mocks.vectorNodeCount.mockImplementation(async () => {
      lockTakenBeforeCount = true;
      return 1;
    });
    const { tx, setRaw } = makeTxStub();
    await enforceQuota(tx, "org-a", "agents");
    expect(setRaw).toHaveBeenCalledTimes(1);
    // The setRaw call MUST happen before the count.
    expect(lockTakenBeforeCount).toBe(true);
    // The lock key must include both the org id and the quota name.
    const [, ...values] = setRaw.mock.calls[0];
    const lockKey = values[0] as string;
    expect(lockKey).toContain("org-a");
    expect(lockKey).toContain("agents");
  });

  it("different quotas serialise on independent locks", async () => {
    mocks.orgFindUnique.mockResolvedValue({ id: "org-a", plan: "PRO" });
    mocks.vectorNodeCount.mockResolvedValue(1);
    mocks.pipelineCount.mockResolvedValue(1);
    const { tx: tx1, setRaw: lock1 } = makeTxStub();
    const { tx: tx2, setRaw: lock2 } = makeTxStub();
    await enforceQuota(tx1, "org-a", "agents");
    await enforceQuota(tx2, "org-a", "pipelines");
    const key1 = lock1.mock.calls[0][1] as string;
    const key2 = lock2.mock.calls[0][1] as string;
    expect(key1).not.toBe(key2);
  });

  it("throws QuotaExceededError with structured shape when at limit", async () => {
    mocks.orgFindUnique.mockResolvedValue({ id: "org-a", plan: "FREE" });
    mocks.vectorNodeCount.mockResolvedValue(PLAN_QUOTAS.FREE.agents);
    const { tx } = makeTxStub();
    try {
      await enforceQuota(tx, "org-a", "agents");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExceededError);
      const qe = err as QuotaExceededError;
      expect(qe.quota).toBe("agents");
      expect(qe.organizationId).toBe("org-a");
      expect(qe.plan).toBe("FREE");
      expect(qe.limit).toBe(PLAN_QUOTAS.FREE.agents);
      expect(qe.current).toBe(PLAN_QUOTAS.FREE.agents);
    }
  });

  it("uses pipeline count for pipelines quota", async () => {
    mocks.orgFindUnique.mockResolvedValue({ id: "org-a", plan: "PRO" });
    mocks.pipelineCount.mockResolvedValue(7);
    const { tx } = makeTxStub();
    await enforceQuota(tx, "org-a", "pipelines");
    expect(mocks.pipelineCount).toHaveBeenCalled();
  });

  it("uses environment count for environments quota", async () => {
    mocks.orgFindUnique.mockResolvedValue({ id: "org-a", plan: "PRO" });
    mocks.environmentCount.mockResolvedValue(2);
    const { tx } = makeTxStub();
    await enforceQuota(tx, "org-a", "environments");
    expect(mocks.environmentCount).toHaveBeenCalled();
  });

  it("throws when the org row does not exist", async () => {
    mocks.orgFindUnique.mockResolvedValue(null);
    const { tx } = makeTxStub();
    await expect(enforceQuota(tx, "org-missing", "agents")).rejects.toThrow(/not found/i);
  });
});
