import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $executeRaw: vi.fn(async () => 1),
  platformAuditLogCreate: vi.fn(),
  platformAuditChainTailFindUnique: vi.fn(),
  platformAuditChainTailUpsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => { const __pm = {
  $transaction: mocks.$transaction,
  $executeRaw: mocks.$executeRaw,
  platformAuditLog: {
    create: mocks.platformAuditLogCreate,
  },
  platformAuditChainTail: {
    findUnique: mocks.platformAuditChainTailFindUnique,
    upsert: mocks.platformAuditChainTailUpsert,
  },
}; return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

import {
  writePlatformAuditLog,
  verifyPlatformAuditChain,
  platformAuditGenesisHash,
} from "../platform-audit-log";

function makeTxStub() {
  return {
    $executeRaw: mocks.$executeRaw,
    platformAuditLog: { create: mocks.platformAuditLogCreate },
    platformAuditChainTail: {
      findUnique: mocks.platformAuditChainTailFindUnique,
      upsert: mocks.platformAuditChainTailUpsert,
    },
  };
}

describe("platformAuditGenesisHash", () => {
  it("is deterministic per deployment", () => {
    const a = platformAuditGenesisHash("deploy-eu-1");
    const b = platformAuditGenesisHash("deploy-eu-1");
    expect(a).toBe(b);
    expect(a).toHaveLength(64); // sha256 hex
  });

  it("differs between deployments", () => {
    expect(platformAuditGenesisHash("deploy-eu-1")).not.toBe(
      platformAuditGenesisHash("deploy-us-1"),
    );
  });
});

describe("writePlatformAuditLog", () => {
  beforeEach(() => {
    mocks.$transaction.mockReset();
    mocks.$executeRaw.mockClear();
    mocks.platformAuditLogCreate.mockReset();
    mocks.platformAuditChainTailFindUnique.mockReset();
    mocks.platformAuditChainTailUpsert.mockReset();

    mocks.$transaction.mockImplementation(
      async (fn: (tx: ReturnType<typeof makeTxStub>) => Promise<unknown>) =>
        fn(makeTxStub()),
    );
  });

  it("uses genesis hash as prevHash when the deployment has no rows yet", async () => {
    mocks.platformAuditChainTailFindUnique.mockResolvedValue(null);
    mocks.platformAuditLogCreate.mockImplementation(async (args) => args.data);
    mocks.platformAuditChainTailUpsert.mockResolvedValue({});

    const result = await writePlatformAuditLog({
      deploymentId: "deploy-x",
      operatorId: "op-1",
      operatorRole: "INCIDENT",
      action: "grant.request",
      organizationId: "org-a",
      reason: "P0 incident",
    });

    expect(result.prevHash).toBe(platformAuditGenesisHash("deploy-x"));
    expect(result.hash).toHaveLength(64);
    expect(mocks.platformAuditLogCreate).toHaveBeenCalledTimes(1);
    const created = mocks.platformAuditLogCreate.mock.calls[0]?.[0]?.data;
    expect(created?.prevHash).toBe(platformAuditGenesisHash("deploy-x"));
    expect(created?.hash).toBe(result.hash);
  });

  it("chains off the existing tail hash on subsequent inserts", async () => {
    mocks.platformAuditChainTailFindUnique.mockResolvedValue({
      lastHash: "deadbeef".repeat(8),
    });
    mocks.platformAuditLogCreate.mockImplementation(async (args) => args.data);
    mocks.platformAuditChainTailUpsert.mockResolvedValue({});

    const result = await writePlatformAuditLog({
      deploymentId: "deploy-x",
      operatorId: "op-2",
      operatorRole: "SUPPORT",
      action: "kms.unwrap",
      organizationId: "org-b",
    });

    expect(result.prevHash).toBe("deadbeef".repeat(8));
    expect(result.hash).not.toBe(result.prevHash);
  });

  it("acquires per-deployment advisory lock BEFORE reading the tail", async () => {
    mocks.platformAuditChainTailFindUnique.mockResolvedValue(null);
    mocks.platformAuditLogCreate.mockImplementation(async (args) => args.data);

    let lockTaken = false;
    mocks.$executeRaw.mockImplementation(async () => {
      lockTaken = true;
      return 1;
    });
    let tailReadAfterLock = false;
    mocks.platformAuditChainTailFindUnique.mockImplementation(async () => {
      tailReadAfterLock = lockTaken;
      return null;
    });

    await writePlatformAuditLog({
      deploymentId: "deploy-x",
      operatorId: "op-3",
      action: "deployment.restart",
    });

    expect(lockTaken).toBe(true);
    expect(tailReadAfterLock).toBe(true);
  });

  it("upserts the chain tail with the new hash", async () => {
    mocks.platformAuditChainTailFindUnique.mockResolvedValue(null);
    mocks.platformAuditLogCreate.mockImplementation(async (args) => args.data);

    const result = await writePlatformAuditLog({
      deploymentId: "deploy-x",
      operatorId: "op-4",
      action: "org.suspend",
      organizationId: "org-c",
    });

    expect(mocks.platformAuditChainTailUpsert).toHaveBeenCalledTimes(1);
    const upsertArgs = mocks.platformAuditChainTailUpsert.mock.calls[0]?.[0];
    expect(upsertArgs?.where?.deploymentId).toBe("deploy-x");
    expect(upsertArgs?.create?.lastHash).toBe(result.hash);
    expect(upsertArgs?.update?.lastHash).toBe(result.hash);
  });

  it("accepts a null operatorId for system-initiated actions", async () => {
    mocks.platformAuditChainTailFindUnique.mockResolvedValue(null);
    mocks.platformAuditLogCreate.mockImplementation(async (args) => args.data);

    await expect(
      writePlatformAuditLog({
        deploymentId: "deploy-x",
        operatorId: null,
        action: "deployment.restart",
        metadata: { trigger: "health-check" },
      }),
    ).resolves.toMatchObject({ hash: expect.any(String) });
  });
});

describe("verifyPlatformAuditChain", () => {
  function makeRow(
    overrides: Partial<{
      id: string;
      deploymentId: string;
      operatorId: string | null;
      operatorRole: string | null;
      action: string;
      organizationId: string | null;
      reason: string | null;
      entityType: string | null;
      entityId: string | null;
      metadata: unknown;
      ipAddress: string | null;
      createdAt: Date;
      prevHash: string;
      hash: string;
    }>,
  ) {
    return {
      id: "r1",
      deploymentId: "deploy-x",
      operatorId: "op-1",
      operatorRole: "SUPPORT",
      action: "grant.request",
      organizationId: "org-a",
      reason: null,
      entityType: null,
      entityId: null,
      metadata: null,
      ipAddress: null,
      createdAt: new Date(0),
      prevHash: platformAuditGenesisHash("deploy-x"),
      hash: "TBD",
      ...overrides,
    };
  }

  it("returns ok:true for a freshly written single-row chain", async () => {
    mocks.platformAuditChainTailFindUnique.mockResolvedValue(null);
    mocks.platformAuditLogCreate.mockImplementation(async (args) => args.data);
    let savedRow: Record<string, unknown> | undefined;
    mocks.platformAuditLogCreate.mockImplementation(async (args) => {
      savedRow = args.data;
      return args.data;
    });
    mocks.$transaction.mockImplementation(
      async (fn: (tx: ReturnType<typeof makeTxStub>) => Promise<unknown>) =>
        fn(makeTxStub()),
    );

    await writePlatformAuditLog({
      deploymentId: "deploy-x",
      operatorId: "op-1",
      operatorRole: "SUPPORT",
      action: "grant.request",
      organizationId: "org-a",
    });

    expect(savedRow).toBeDefined();
    const ver = verifyPlatformAuditChain(
      [savedRow as never],
      platformAuditGenesisHash("deploy-x"),
    );
    expect(ver).toEqual({ ok: true });
  });

  it("reports brokenAt:0 when the first row's prevHash != genesis", () => {
    const row = makeRow({ prevHash: "0".repeat(64) });
    row.hash = "ignored";
    const ver = verifyPlatformAuditChain(
      [row],
      platformAuditGenesisHash("deploy-x"),
    );
    expect(ver.ok).toBe(false);
    if (!ver.ok) {
      expect(ver.brokenAt).toBe(0);
      expect(ver.reason).toMatch(/prevHash mismatch/);
    }
  });

  it("reports brokenAt index when a middle row was tampered", async () => {
    // Build a valid 3-row chain via writePlatformAuditLog, then mutate
    // row 1's metadata so its stored hash no longer matches.
    mocks.platformAuditChainTailFindUnique.mockReset();
    mocks.platformAuditLogCreate.mockReset();
    mocks.platformAuditChainTailUpsert.mockReset();

    const written: Array<Record<string, unknown>> = [];
    let tail: string | null = null;
    mocks.platformAuditChainTailFindUnique.mockImplementation(async () =>
      tail ? { lastHash: tail } : null,
    );
    mocks.platformAuditLogCreate.mockImplementation(async (args) => {
      written.push(args.data as Record<string, unknown>);
      return args.data;
    });
    mocks.platformAuditChainTailUpsert.mockImplementation(async (args) => {
      tail = args.update.lastHash as string;
      return {};
    });
    mocks.$transaction.mockImplementation(
      async (fn: (tx: ReturnType<typeof makeTxStub>) => Promise<unknown>) =>
        fn(makeTxStub()),
    );

    for (const action of ["grant.request", "grant.approve", "grant.use"] as const) {
      await writePlatformAuditLog({
        deploymentId: "deploy-x",
        operatorId: "op-1",
        operatorRole: "SUPPORT",
        action,
        organizationId: "org-a",
      });
    }

    // Sanity: intact chain verifies.
    const intact = verifyPlatformAuditChain(
      written as never,
      platformAuditGenesisHash("deploy-x"),
    );
    expect(intact.ok).toBe(true);

    // Tamper: mutate row 1's metadata without recomputing the hash.
    (written[1] as Record<string, unknown>).metadata = { tampered: true };

    const broken = verifyPlatformAuditChain(
      written as never,
      platformAuditGenesisHash("deploy-x"),
    );
    expect(broken.ok).toBe(false);
    if (!broken.ok) {
      expect(broken.brokenAt).toBe(1);
      expect(broken.reason).toMatch(/hash mismatch/);
    }
  });
});
