import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  orgFindUnique: vi.fn(),
  vectorNodeCount: vi.fn(),
  pipelineCount: vi.fn(),
  environmentCount: vi.fn(),
  $transaction: vi.fn(),
  $executeRaw: vi.fn(async () => 1),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: mocks.orgFindUnique },
    vectorNode: { count: mocks.vectorNodeCount },
    pipeline: { count: mocks.pipelineCount },
    environment: { count: mocks.environmentCount },
    $transaction: mocks.$transaction,
    $executeRaw: mocks.$executeRaw,
  },
}));

import {
  PLAN_QUOTAS,
  checkQuota,
  enforceQuotaInTx,
  withQuotaCheck,
  QuotaExceededError,
  type PrismaTxLike,
} from "../quotas";

function makeTxStub(): PrismaTxLike {
  return {
    $executeRaw: mocks.$executeRaw as unknown as PrismaTxLike["$executeRaw"],
    organization: { findUnique: mocks.orgFindUnique as never },
    vectorNode: { count: mocks.vectorNodeCount as never },
    pipeline: { count: mocks.pipelineCount as never },
    environment: { count: mocks.environmentCount as never },
  };
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
  });

  it("returns allowed=true when current < limit", async () => {
    mocks.orgFindUnique.mockResolvedValue({ plan: "FREE" });
    mocks.vectorNodeCount.mockResolvedValue(3);
    const r = await checkQuota("org-a", "agents");
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(PLAN_QUOTAS.FREE.agents);
    expect(r.current).toBe(3);
  });

  it("returns allowed=false when current == limit (no off-by-one)", async () => {
    mocks.orgFindUnique.mockResolvedValue({ plan: "FREE" });
    mocks.vectorNodeCount.mockResolvedValue(PLAN_QUOTAS.FREE.agents);
    const r = await checkQuota("org-a", "agents");
    expect(r.allowed).toBe(false);
  });

  it("ENTERPRISE never exceeds (Infinity)", async () => {
    mocks.orgFindUnique.mockResolvedValue({ plan: "ENTERPRISE" });
    mocks.vectorNodeCount.mockResolvedValue(10_000_000);
    const r = await checkQuota("org-a", "agents");
    expect(r.allowed).toBe(true);
  });

  it("throws when org not found", async () => {
    mocks.orgFindUnique.mockResolvedValue(null);
    await expect(checkQuota("org-missing", "agents")).rejects.toThrow(/not found/i);
  });
});

describe("enforceQuotaInTx (advanced API)", () => {
  beforeEach(() => {
    mocks.orgFindUnique.mockReset();
    mocks.vectorNodeCount.mockReset();
    mocks.$executeRaw.mockClear();
  });

  it("resolves when allowed", async () => {
    mocks.orgFindUnique.mockResolvedValue({ plan: "FREE" });
    mocks.vectorNodeCount.mockResolvedValue(1);
    await expect(
      enforceQuotaInTx(makeTxStub(), "org-a", "agents"),
    ).resolves.toBeUndefined();
  });

  it("acquires per-(org, quota) advisory lock BEFORE counting", async () => {
    mocks.orgFindUnique.mockResolvedValue({ plan: "FREE" });
    let lockTakenBeforeCount = false;
    mocks.vectorNodeCount.mockImplementation(async () => {
      lockTakenBeforeCount = true;
      return 1;
    });
    await enforceQuotaInTx(makeTxStub(), "org-a", "agents");
    expect(mocks.$executeRaw).toHaveBeenCalledTimes(1);
    expect(lockTakenBeforeCount).toBe(true);
    const callArgs = mocks.$executeRaw.mock.calls[0] as unknown as unknown[];
    const lockKey = callArgs[1] as string;
    expect(lockKey).toContain("org-a");
    expect(lockKey).toContain("agents");
  });

  it("throws QuotaExceededError with structured shape", async () => {
    mocks.orgFindUnique.mockResolvedValue({ plan: "FREE" });
    mocks.vectorNodeCount.mockResolvedValue(PLAN_QUOTAS.FREE.agents);
    try {
      await enforceQuotaInTx(makeTxStub(), "org-a", "agents");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExceededError);
      const qe = err as QuotaExceededError;
      expect(qe.quota).toBe("agents");
      expect(qe.plan).toBe("FREE");
      expect(qe.limit).toBe(PLAN_QUOTAS.FREE.agents);
    }
  });
});

describe("withQuotaCheck (canonical API)", () => {
  beforeEach(() => {
    mocks.orgFindUnique.mockReset();
    mocks.vectorNodeCount.mockReset();
    mocks.$transaction.mockReset();
    mocks.$executeRaw.mockClear();
  });

  it("opens a transaction, runs quota check, then create within the same tx", async () => {
    mocks.orgFindUnique.mockResolvedValue({ plan: "FREE" });
    mocks.vectorNodeCount.mockResolvedValue(1);
    let createSawSameTx = false;
    const tx = makeTxStub();
    mocks.$transaction.mockImplementation(async (fn: (t: PrismaTxLike) => Promise<unknown>) => fn(tx));

    const result = await withQuotaCheck("org-a", "agents", async (innerTx) => {
      createSawSameTx = innerTx === tx;
      return { ok: true };
    });

    expect(result).toEqual({ ok: true });
    expect(createSawSameTx).toBe(true);
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
  });

  it("does NOT invoke the create callback when quota is exceeded", async () => {
    mocks.orgFindUnique.mockResolvedValue({ plan: "FREE" });
    mocks.vectorNodeCount.mockResolvedValue(PLAN_QUOTAS.FREE.agents);
    const tx = makeTxStub();
    mocks.$transaction.mockImplementation(async (fn: (t: PrismaTxLike) => Promise<unknown>) => fn(tx));
    const create = vi.fn();
    await expect(
      withQuotaCheck("org-a", "agents", create),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    expect(create).not.toHaveBeenCalled();
  });

  it("propagates errors from the create callback", async () => {
    mocks.orgFindUnique.mockResolvedValue({ plan: "FREE" });
    mocks.vectorNodeCount.mockResolvedValue(1);
    const tx = makeTxStub();
    mocks.$transaction.mockImplementation(async (fn: (t: PrismaTxLike) => Promise<unknown>) => fn(tx));
    await expect(
      withQuotaCheck("org-a", "agents", async () => {
        throw new Error("downstream constraint violation");
      }),
    ).rejects.toThrow(/downstream/);
  });

  it("post-check throws when the callback inserts more than headroom (defeats createMany)", async () => {
    mocks.orgFindUnique.mockResolvedValue({ plan: "FREE" });
    let counted = 0;
    mocks.vectorNodeCount.mockImplementation(async () => {
      counted++;
      return counted === 1 ? 3 : 8;
    });
    const tx = makeTxStub();
    mocks.$transaction.mockImplementation(async (fn: (t: PrismaTxLike) => Promise<unknown>) => fn(tx));
    await expect(
      withQuotaCheck("org-a", "agents", async () => ({ count: 5 })),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    expect(counted).toBe(2);
  });
});
