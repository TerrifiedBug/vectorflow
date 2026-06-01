import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

import { prisma } from "@/lib/prisma";
import {
  approveOrgAccessGrant,
  expireStaleOrgAccessGrants,
  isGrantActive,
  listOrgAccessGrantsForOrg,
  requestOrgAccessGrant,
  revokeOrgAccessGrant,
} from "@/server/services/org-access-grant";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const NOW = new Date("2026-04-01T12:00:00Z");

function makeGrant(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant-1",
    organizationId: "org-1",
    operatorId: "op-1",
    reason: "Customer reported decryption error in pipeline-42",
    approvedByCustomerAdminId: null as string | null,
    externalGrantRef: null as string | null,
    expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
    revokedAt: null as Date | null,
    createdAt: NOW,
    ...overrides,
  };
}

describe("isGrantActive", () => {
  const ONE_HOUR_FROM_NOW = new Date(NOW.getTime() + 60 * 60 * 1000);
  const ONE_HOUR_AGO = new Date(NOW.getTime() - 60 * 60 * 1000);

  it("returns false when not yet approved", () => {
    expect(
      isGrantActive(
        {
          approvedByCustomerAdminId: null,
          expiresAt: ONE_HOUR_FROM_NOW,
          revokedAt: null,
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("returns false when revoked, even if approved + unexpired", () => {
    expect(
      isGrantActive(
        {
          approvedByCustomerAdminId: "admin-1",
          expiresAt: ONE_HOUR_FROM_NOW,
          revokedAt: NOW,
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("returns false when expired", () => {
    expect(
      isGrantActive(
        {
          approvedByCustomerAdminId: "admin-1",
          expiresAt: ONE_HOUR_AGO,
          revokedAt: null,
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("returns true when approved + unexpired + not revoked", () => {
    expect(
      isGrantActive(
        {
          approvedByCustomerAdminId: "admin-1",
          expiresAt: ONE_HOUR_FROM_NOW,
          revokedAt: null,
        },
        NOW,
      ),
    ).toBe(true);
  });

  it("uses real time when `now` arg is omitted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(
      isGrantActive({
        approvedByCustomerAdminId: "admin-1",
        expiresAt: ONE_HOUR_FROM_NOW,
        revokedAt: null,
      }),
    ).toBe(true);
    vi.useRealTimers();
  });
});

describe("requestOrgAccessGrant", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("creates a grant row with derived expiresAt", async () => {
    prismaMock.orgAccessGrant.create.mockResolvedValue(makeGrant() as never);

    await requestOrgAccessGrant(
      {
        operatorId: "op-1",
        organizationId: "org-1",
        reason: "Customer reported decryption error",
        durationMs: 30 * 60 * 1000,
      },
      { now: NOW },
    );

    const callArg = prismaMock.orgAccessGrant.create.mock.calls[0][0]?.data;
    expect(callArg).toMatchObject({
      operatorId: "op-1",
      organizationId: "org-1",
      reason: "Customer reported decryption error",
    });
    expect((callArg?.expiresAt as Date).getTime()).toBe(
      NOW.getTime() + 30 * 60 * 1000,
    );
    expect(callArg).not.toHaveProperty("approvedByCustomerAdminId");
    expect(callArg).not.toHaveProperty("externalGrantRef");
  });

  it("rejects an empty / too-short reason", async () => {
    await expect(
      requestOrgAccessGrant(
        { operatorId: "op-1", organizationId: "org-1", reason: "debug" },
        { now: NOW },
      ),
    ).rejects.toThrow("reason must be at least 16 characters");
  });

  it("rejects non-positive durationMs", async () => {
    await expect(
      requestOrgAccessGrant(
        {
          operatorId: "op-1",
          organizationId: "org-1",
          reason: "Customer reported decryption error",
          durationMs: 0,
        },
        { now: NOW },
      ),
    ).rejects.toThrow("durationMs must be positive");
    await expect(
      requestOrgAccessGrant(
        {
          operatorId: "op-1",
          organizationId: "org-1",
          reason: "Customer reported decryption error",
          durationMs: -1000,
        },
        { now: NOW },
      ),
    ).rejects.toThrow("durationMs must be positive");
  });

  it("defaults to a 1-hour duration when none supplied", async () => {
    prismaMock.orgAccessGrant.create.mockResolvedValue(makeGrant() as never);
    await requestOrgAccessGrant(
      {
        operatorId: "op-1",
        organizationId: "org-1",
        reason: "Customer reported decryption error",
      },
      { now: NOW },
    );
    const callArg = prismaMock.orgAccessGrant.create.mock.calls[0][0]?.data;
    expect((callArg?.expiresAt as Date).getTime()).toBe(
      NOW.getTime() + 60 * 60 * 1000,
    );
  });
});

describe("approveOrgAccessGrant", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("approves a pending grant via atomic conditional updateMany", async () => {
    prismaMock.orgAccessGrant.findUnique.mockResolvedValueOnce(
      makeGrant() as never,
    );
    prismaMock.orgAccessGrant.updateMany.mockResolvedValue({
      count: 1,
    } as never);
    prismaMock.orgAccessGrant.findUniqueOrThrow.mockResolvedValue(
      makeGrant({ approvedByCustomerAdminId: "admin-1" }) as never,
    );

    const out = await approveOrgAccessGrant(
      { grantId: "grant-1", approvedByCustomerAdminId: "admin-1" },
      { now: NOW },
    );

    expect(prismaMock.orgAccessGrant.updateMany).toHaveBeenCalledWith({
      where: {
        id: "grant-1",
        approvedByCustomerAdminId: null,
        revokedAt: null,
        expiresAt: { gt: NOW },
      },
      data: { approvedByCustomerAdminId: "admin-1" },
    });
    expect(out.approvedByCustomerAdminId).toBe("admin-1");
  });

  it("is idempotent when the same admin re-approves", async () => {
    const existing = makeGrant({ approvedByCustomerAdminId: "admin-1" });
    prismaMock.orgAccessGrant.findUnique.mockResolvedValue(existing as never);

    const out = await approveOrgAccessGrant(
      { grantId: "grant-1", approvedByCustomerAdminId: "admin-1" },
      { now: NOW },
    );

    expect(out).toEqual(existing);
    expect(prismaMock.orgAccessGrant.updateMany).not.toHaveBeenCalled();
  });

  it("rejects approval by a different admin (accountability)", async () => {
    prismaMock.orgAccessGrant.findUnique.mockResolvedValue(
      makeGrant({ approvedByCustomerAdminId: "admin-1" }) as never,
    );
    await expect(
      approveOrgAccessGrant(
        { grantId: "grant-1", approvedByCustomerAdminId: "admin-2" },
        { now: NOW },
      ),
    ).rejects.toThrow("already approved by a different customer admin");
  });

  it("rejects approval of an expired grant", async () => {
    prismaMock.orgAccessGrant.findUnique.mockResolvedValue(
      makeGrant({ expiresAt: new Date(NOW.getTime() - 1) }) as never,
    );
    await expect(
      approveOrgAccessGrant(
        { grantId: "grant-1", approvedByCustomerAdminId: "admin-1" },
        { now: NOW },
      ),
    ).rejects.toThrow("expired grant");
  });

  it("rejects approval of a revoked grant", async () => {
    prismaMock.orgAccessGrant.findUnique.mockResolvedValue(
      makeGrant({ revokedAt: new Date(NOW.getTime() - 1000) }) as never,
    );
    await expect(
      approveOrgAccessGrant(
        { grantId: "grant-1", approvedByCustomerAdminId: "admin-1" },
        { now: NOW },
      ),
    ).rejects.toThrow("revoked grant");
  });

  it("throws when grant does not exist", async () => {
    prismaMock.orgAccessGrant.findUnique.mockResolvedValue(null as never);
    await expect(
      approveOrgAccessGrant(
        { grantId: "missing", approvedByCustomerAdminId: "admin-1" },
        { now: NOW },
      ),
    ).rejects.toThrow("no grant with id missing");
  });

  it("losing race surfaces as 'different admin' error when concurrent admin won", async () => {
    prismaMock.orgAccessGrant.findUnique
      .mockResolvedValueOnce(makeGrant() as never)
      .mockResolvedValueOnce(
        makeGrant({ approvedByCustomerAdminId: "admin-2" }) as never,
      );
    prismaMock.orgAccessGrant.updateMany.mockResolvedValue({
      count: 0,
    } as never);

    await expect(
      approveOrgAccessGrant(
        { grantId: "grant-1", approvedByCustomerAdminId: "admin-1" },
        { now: NOW },
      ),
    ).rejects.toThrow(
      "approved by a different customer admin in a concurrent request",
    );
  });

  it("losing race to expiry surfaces as 'expired between request and approval'", async () => {
    prismaMock.orgAccessGrant.findUnique
      .mockResolvedValueOnce(makeGrant() as never)
      .mockResolvedValueOnce(
        makeGrant({ expiresAt: new Date(NOW.getTime() - 1) }) as never,
      );
    prismaMock.orgAccessGrant.updateMany.mockResolvedValue({
      count: 0,
    } as never);

    await expect(
      approveOrgAccessGrant(
        { grantId: "grant-1", approvedByCustomerAdminId: "admin-1" },
        { now: NOW },
      ),
    ).rejects.toThrow("expired between request and approval");
  });

  it("losing race to revocation surfaces as 'revoked between request and approval'", async () => {
    prismaMock.orgAccessGrant.findUnique
      .mockResolvedValueOnce(makeGrant() as never)
      .mockResolvedValueOnce(makeGrant({ revokedAt: NOW }) as never);
    prismaMock.orgAccessGrant.updateMany.mockResolvedValue({
      count: 0,
    } as never);

    await expect(
      approveOrgAccessGrant(
        { grantId: "grant-1", approvedByCustomerAdminId: "admin-1" },
        { now: NOW },
      ),
    ).rejects.toThrow("revoked between request and approval");
  });
});

describe("revokeOrgAccessGrant", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("stamps revokedAt", async () => {
    prismaMock.orgAccessGrant.findUnique.mockResolvedValue(
      makeGrant({ approvedByCustomerAdminId: "admin-1" }) as never,
    );
    prismaMock.orgAccessGrant.update.mockResolvedValue(
      makeGrant({ revokedAt: NOW }) as never,
    );

    await revokeOrgAccessGrant("grant-1", { now: NOW });

    expect(prismaMock.orgAccessGrant.update).toHaveBeenCalledWith({
      where: { id: "grant-1" },
      data: { revokedAt: NOW },
    });
  });

  it("is idempotent on already-revoked grant", async () => {
    const existing = makeGrant({
      revokedAt: new Date(NOW.getTime() - 60_000),
    });
    prismaMock.orgAccessGrant.findUnique.mockResolvedValue(existing as never);

    const out = await revokeOrgAccessGrant("grant-1", { now: NOW });

    expect(out).toEqual(existing);
    expect(prismaMock.orgAccessGrant.update).not.toHaveBeenCalled();
  });
});

describe("expireStaleOrgAccessGrants", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("updates all expired, non-revoked grants in one UPDATE and returns count", async () => {
    prismaMock.orgAccessGrant.updateMany.mockResolvedValue({ count: 5 } as never);

    const count = await expireStaleOrgAccessGrants({ now: NOW });

    expect(count).toBe(5);
    expect(prismaMock.orgAccessGrant.updateMany).toHaveBeenCalledWith({
      where: {
        revokedAt: null,
        expiresAt: { lte: NOW },
      },
      data: { revokedAt: NOW },
    });
  });
});

describe("listOrgAccessGrantsForOrg", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("returns grants with externalGrantRef masked to a presence boolean", async () => {
    prismaMock.orgAccessGrant.findMany.mockResolvedValue([
      makeGrant({ id: "g1", externalGrantRef: "real-token-bytes" }),
      makeGrant({ id: "g2", externalGrantRef: null }),
    ] as never);

    const out = await listOrgAccessGrantsForOrg("org-1");

    expect(out).toHaveLength(2);
    expect(out[0]).not.toHaveProperty("externalGrantRef");
    expect(out[0]?.hasExternalGrantRef).toBe(true);
    expect(out[1]?.hasExternalGrantRef).toBe(false);
  });
});
