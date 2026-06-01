import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  orgFindUnique: vi.fn(),
  vectorNodeCount: vi.fn(),
  pipelineCount: vi.fn(),
  environmentCount: vi.fn(),
  $transaction: vi.fn(),
  $executeRaw: vi.fn(async () => 1),
}));

vi.mock("@/lib/prisma", () => { const __pm = {
  organization: { findUnique: mocks.orgFindUnique },
  vectorNode: { count: mocks.vectorNodeCount },
  pipeline: { count: mocks.pipelineCount },
  environment: { count: mocks.environmentCount },
  $transaction: mocks.$transaction,
  $executeRaw: mocks.$executeRaw,
}; return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

import {
  PLAN_QUOTAS,
  checkQuota,
  enforceQuotaInTx,
  withQuotaCheck,
  QuotaExceededError,
  setQuotaPolicy,
  resetQuotaPolicy,
  getActivePlanQuotas,
  DefaultUnboundedQuotaPolicy,
  type PrismaTxLike,
  type QuotaPolicyProvider,
  type PlanQuotas,
  type PlanName,
} from "../quotas";

/**
 * Test-only provider mimicking the kind of overlay the strict-multi-tenant build
 * will register. Exposes finite limits for the engine tests so the
 * QuotaExceededError branch is exercised without baking commercial
 * tier names into OSS.
 */
class FiniteTestQuotaPolicy implements QuotaPolicyProvider {
  constructor(private readonly schedule: Record<string, PlanQuotas>) {}
  getPlanQuotas(plan: PlanName): PlanQuotas {
    return (
      this.schedule[plan] ??
      this.schedule.DEFAULT ?? {
        agents: Number.POSITIVE_INFINITY,
        pipelines: Number.POSITIVE_INFINITY,
        environments: Number.POSITIVE_INFINITY,
      }
    );
  }
}

const FINITE_PROVIDER = new FiniteTestQuotaPolicy({
  DEFAULT: { agents: 5, pipelines: 10, environments: 1 },
  UNLIMITED: {
    agents: Number.POSITIVE_INFINITY,
    pipelines: Number.POSITIVE_INFINITY,
    environments: Number.POSITIVE_INFINITY,
  },
});

function makeTxStub(): PrismaTxLike {
  return {
    $executeRaw: mocks.$executeRaw as unknown as PrismaTxLike["$executeRaw"],
    organization: { findUnique: mocks.orgFindUnique as never },
    vectorNode: { count: mocks.vectorNodeCount as never },
    pipeline: { count: mocks.pipelineCount as never },
    environment: { count: mocks.environmentCount as never },
  };
}

describe("DefaultUnboundedQuotaPolicy (OSS default)", () => {
  afterEach(() => resetQuotaPolicy());

  it("returns Infinity quotas for every plan name (self-hosted is unmetered)", () => {
    const p = new DefaultUnboundedQuotaPolicy();
    for (const plan of ["DEFAULT", "FREE", "PRO", "ENTERPRISE", "unknown"]) {
      const q = p.getPlanQuotas(plan);
      expect(q.agents).toBe(Number.POSITIVE_INFINITY);
      expect(q.pipelines).toBe(Number.POSITIVE_INFINITY);
      expect(q.environments).toBe(Number.POSITIVE_INFINITY);
    }
  });

  it("`PLAN_QUOTAS.DEFAULT` reflects the active provider", () => {
    expect(PLAN_QUOTAS.DEFAULT.agents).toBe(Number.POSITIVE_INFINITY);
    setQuotaPolicy(FINITE_PROVIDER);
    expect(PLAN_QUOTAS.DEFAULT.agents).toBe(5);
  });

  it("setQuotaPolicy returns the previous provider for restoration", () => {
    const prev = setQuotaPolicy(FINITE_PROVIDER);
    expect(prev).toBeInstanceOf(DefaultUnboundedQuotaPolicy);
    const cur = setQuotaPolicy(prev);
    expect(cur).toBe(FINITE_PROVIDER);
  });
});

describe("checkQuota (read-only)", () => {
  beforeEach(() => {
    mocks.orgFindUnique.mockReset();
    mocks.vectorNodeCount.mockReset();
    setQuotaPolicy(FINITE_PROVIDER);
  });
  afterEach(() => resetQuotaPolicy());

  it("returns allowed=true when current < limit", async () => {
    mocks.orgFindUnique.mockResolvedValue({ plan: "DEFAULT" });
    mocks.vectorNodeCount.mockResolvedValue(3);
    const r = await checkQuota("org-a", "agents");
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(getActivePlanQuotas("DEFAULT").agents);
    expect(r.current).toBe(3);
  });

  it("returns allowed=false when current == limit (no off-by-one)", async () => {
    mocks.orgFindUnique.mockResolvedValue({ plan: "DEFAULT" });
    mocks.vectorNodeCount.mockResolvedValue(getActivePlanQuotas("DEFAULT").agents);
    const r = await checkQuota("org-a", "agents");
    expect(r.allowed).toBe(false);
  });

  it("UNLIMITED plan never exceeds (Infinity)", async () => {
    mocks.orgFindUnique.mockResolvedValue({ plan: "UNLIMITED" });
    mocks.vectorNodeCount.mockResolvedValue(10_000_000);
    const r = await checkQuota("org-a", "agents");
    expect(r.allowed).toBe(true);
  });

  it("unknown plan name falls back to provider's DEFAULT", async () => {
    mocks.orgFindUnique.mockResolvedValue({ plan: "MYSTERY_TIER" });
    mocks.vectorNodeCount.mockResolvedValue(0);
    const r = await checkQuota("org-a", "agents");
    expect(r.limit).toBe(getActivePlanQuotas("DEFAULT").agents);
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
    setQuotaPolicy(FINITE_PROVIDER);
  });
  afterEach(() => resetQuotaPolicy());

  it("resolves when allowed", async () => {
    mocks.orgFindUnique.mockResolvedValue({ plan: "DEFAULT" });
    mocks.vectorNodeCount.mockResolvedValue(1);
    await expect(
      enforceQuotaInTx(makeTxStub(), "org-a", "agents"),
    ).resolves.toBeUndefined();
  });

  it("acquires per-(org, quota) advisory lock BEFORE counting", async () => {
    mocks.orgFindUnique.mockResolvedValue({ plan: "DEFAULT" });
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
    mocks.orgFindUnique.mockResolvedValue({ plan: "DEFAULT" });
    mocks.vectorNodeCount.mockResolvedValue(getActivePlanQuotas("DEFAULT").agents);
    try {
      await enforceQuotaInTx(makeTxStub(), "org-a", "agents");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExceededError);
      const qe = err as QuotaExceededError;
      expect(qe.quota).toBe("agents");
      expect(qe.plan).toBe("DEFAULT");
      expect(qe.limit).toBe(getActivePlanQuotas("DEFAULT").agents);
    }
  });

  it("OSS default provider (unbounded) never throws", async () => {
    resetQuotaPolicy();
    mocks.orgFindUnique.mockResolvedValue({ plan: "DEFAULT" });
    mocks.vectorNodeCount.mockResolvedValue(1_000_000);
    await expect(
      enforceQuotaInTx(makeTxStub(), "org-a", "agents"),
    ).resolves.toBeUndefined();
  });
});

describe("withQuotaCheck (canonical API)", () => {
  beforeEach(() => {
    mocks.orgFindUnique.mockReset();
    mocks.vectorNodeCount.mockReset();
    mocks.$transaction.mockReset();
    mocks.$executeRaw.mockClear();
    setQuotaPolicy(FINITE_PROVIDER);
  });
  afterEach(() => resetQuotaPolicy());

  it("opens a transaction, runs quota check, then create within the same tx", async () => {
    mocks.orgFindUnique.mockResolvedValue({ plan: "DEFAULT" });
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
    mocks.orgFindUnique.mockResolvedValue({ plan: "DEFAULT" });
    mocks.vectorNodeCount.mockResolvedValue(getActivePlanQuotas("DEFAULT").agents);
    const tx = makeTxStub();
    mocks.$transaction.mockImplementation(async (fn: (t: PrismaTxLike) => Promise<unknown>) => fn(tx));
    const create = vi.fn();
    await expect(
      withQuotaCheck("org-a", "agents", create),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    expect(create).not.toHaveBeenCalled();
  });

  it("propagates errors from the create callback", async () => {
    mocks.orgFindUnique.mockResolvedValue({ plan: "DEFAULT" });
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
    mocks.orgFindUnique.mockResolvedValue({ plan: "DEFAULT" });
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
