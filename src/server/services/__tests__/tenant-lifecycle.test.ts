import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
  organizationFindUnique: vi.fn(),
  organizationFindMany: vi.fn(),
  organizationUpdate: vi.fn(),
  organizationUpdateMany: vi.fn(),
  auditLogCreate: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/prisma", () => { const __pm = {
  $transaction: mocks.$transaction,
  organization: {
    findUnique: mocks.organizationFindUnique,
    findMany: mocks.organizationFindMany,
    update: mocks.organizationUpdate,
    updateMany: mocks.organizationUpdateMany,
  },
  auditLog: { create: mocks.auditLogCreate },
}; return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

vi.mock("@/server/services/audit", () => ({
  writeAuditLog: mocks.writeAuditLog,
}));

import {
  requestOrgDeletion,
  cancelOrgDeletion,
  listOrgsPastGrace,
  describeDeletionBanner,
} from "../tenant-lifecycle";

function makeTxStub() {
  return {
    $executeRaw: vi.fn(),
    organization: {
      findUnique: mocks.organizationFindUnique,
      update: mocks.organizationUpdate,
      updateMany: mocks.organizationUpdateMany,
    },
    auditLog: { create: mocks.auditLogCreate },
  };
}

describe("requestOrgDeletion", () => {
  beforeEach(() => {
    mocks.$transaction.mockReset();
    mocks.organizationFindUnique.mockReset();
    mocks.organizationUpdate.mockReset();
    mocks.organizationUpdateMany.mockReset();
    mocks.auditLogCreate.mockReset();
    mocks.writeAuditLog.mockReset();
    mocks.writeAuditLog.mockResolvedValue(undefined);
    mocks.$transaction.mockImplementation(async (fn) => fn(makeTxStub()));
  });

  it("sets deletedAt and writes a chained AuditLog row via writeAuditLog", async () => {
    mocks.organizationFindUnique.mockResolvedValue({
      id: "org-a",
      deletedAt: null,
    });
    mocks.organizationUpdateMany.mockResolvedValue({ count: 1 });

    const result = await requestOrgDeletion("org-a", {
      kind: "customer",
      id: "user-1",
      ipAddress: "1.2.3.4",
    });

    expect(result.alreadyPending).toBe(false);
    expect(result.deletedAt).toBeInstanceOf(Date);
    expect(result.scheduledHardDeleteAt.getTime()).toBeGreaterThan(
      result.deletedAt.getTime(),
    );

    expect(mocks.organizationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "org-a", deletedAt: null }),
        data: { deletedAt: expect.any(Date) },
      }),
    );

    // writeAuditLog (chained) must be called instead of tx.auditLog.create.
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-a",
        action: "org.softdelete",
        entityType: "Organization",
        entityId: "org-a",
        userId: "user-1",
        ipAddress: "1.2.3.4",
      }),
    );
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it("idempotent on second call — returns the existing deletedAt", async () => {
    const existingDeletedAt = new Date("2026-05-01T00:00:00Z");
    mocks.organizationFindUnique.mockResolvedValue({
      id: "org-a",
      deletedAt: existingDeletedAt,
    });

    const result = await requestOrgDeletion("org-a", {
      kind: "customer",
      id: "user-1",
    });

    expect(result.alreadyPending).toBe(true);
    expect(result.deletedAt).toEqual(existingDeletedAt);
    expect(mocks.organizationUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("includes operatorId in metadata when kind=operator; userId stays null", async () => {
    mocks.organizationFindUnique.mockResolvedValue({
      id: "org-a",
      deletedAt: null,
    });
    mocks.organizationUpdateMany.mockResolvedValue({ count: 1 });

    await requestOrgDeletion("org-a", {
      kind: "operator",
      id: "op-1",
      reason: "compliance request",
    });

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        metadata: expect.objectContaining({
          requestedBy: "operator",
          operatorId: "op-1",
          reason: "compliance request",
        }),
      }),
    );
  });

  it("throws when the org does not exist", async () => {
    mocks.organizationFindUnique.mockResolvedValue(null);
    await expect(
      requestOrgDeletion("org-missing", { kind: "customer", id: "u1" }),
    ).rejects.toThrow(/not found/);
  });

  it("throws not-found when org is hard-deleted between CAS read and re-read", async () => {
    mocks.organizationFindUnique
      .mockResolvedValueOnce({ id: "org-a", deletedAt: null }) // initial read
      .mockResolvedValueOnce(null); // re-read after CAS miss
    mocks.organizationUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      requestOrgDeletion("org-a", { kind: "customer", id: "u1" }),
    ).rejects.toThrow(/not found/);
  });

  it("throws when concurrent cancel cleared deletedAt before CAS reread", async () => {
    mocks.organizationFindUnique
      .mockResolvedValueOnce({ id: "org-a", deletedAt: null }) // initial read (no deletion)
      .mockResolvedValueOnce({ id: "org-a", deletedAt: null }); // reread after CAS miss: cancel cleared it
    mocks.organizationUpdateMany.mockResolvedValue({ count: 0 }); // CAS missed

    await expect(
      requestOrgDeletion("org-a", { kind: "customer", id: "u1" }),
    ).rejects.toThrow(/concurrent cancel/i);
  });
});

describe("cancelOrgDeletion", () => {
  beforeEach(() => {
    mocks.$transaction.mockReset();
    mocks.organizationFindUnique.mockReset();
    mocks.organizationUpdate.mockReset();
    mocks.organizationUpdateMany.mockReset();
    mocks.auditLogCreate.mockReset();
    mocks.writeAuditLog.mockReset();
    mocks.writeAuditLog.mockResolvedValue(undefined);
    mocks.$transaction.mockImplementation(async (fn) => fn(makeTxStub()));
  });

  it("clears deletedAt during the grace window using atomic updateMany", async () => {
    const recent = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mocks.organizationFindUnique.mockResolvedValue({
      id: "org-a",
      deletedAt: recent,
    });
    mocks.organizationUpdateMany.mockResolvedValue({ count: 1 });

    const r = await cancelOrgDeletion("org-a", {
      kind: "customer",
      id: "user-1",
    });
    expect(r.cancelled).toBe(true);
    expect(r.wasScheduledFor).toBeInstanceOf(Date);

    // Must use updateMany with deletedAt not-null guard, not unconditional update.
    expect(mocks.organizationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "org-a",
          deletedAt: { not: null },
        }),
        data: { deletedAt: null },
      }),
    );

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "org.softdelete.cancel",
        userId: "user-1",
      }),
    );
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it("no-op when the org is not pending deletion", async () => {
    mocks.organizationFindUnique.mockResolvedValue({
      id: "org-a",
      deletedAt: null,
    });
    const r = await cancelOrgDeletion("org-a", {
      kind: "customer",
      id: "user-1",
    });
    expect(r.cancelled).toBe(false);
    expect(r.wasScheduledFor).toBeNull();
    expect(mocks.organizationUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses to cancel after the grace window has elapsed", async () => {
    const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    mocks.organizationFindUnique.mockResolvedValue({
      id: "org-a",
      deletedAt: longAgo,
    });
    await expect(
      cancelOrgDeletion("org-a", { kind: "customer", id: "user-1" }),
    ).rejects.toThrow(/grace window/i);
  });

  it("preserves operator attribution in metadata when kind=operator", async () => {
    const recent = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mocks.organizationFindUnique.mockResolvedValue({
      id: "org-a",
      deletedAt: recent,
    });
    mocks.organizationUpdateMany.mockResolvedValue({ count: 1 });

    await cancelOrgDeletion("org-a", {
      kind: "operator",
      id: "op-2",
    });

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        metadata: expect.objectContaining({ operatorId: "op-2" }),
      }),
    );
  });
});

describe("listOrgsPastGrace", () => {
  beforeEach(() => {
    mocks.organizationFindMany.mockReset();
  });

  it("returns orgs whose deletedAt is older than the grace window", async () => {
    const longAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    mocks.organizationFindMany.mockResolvedValue([
      { id: "org-old", slug: "old", deletedAt: longAgo },
      { id: "org-recent", slug: "recent", deletedAt: recent },
    ]);

    const result = await listOrgsPastGrace();

    expect(mocks.organizationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: expect.objectContaining({ not: null, lte: expect.any(Date) }),
        }),
      }),
    );
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.organizationId)).toEqual(["org-old", "org-recent"]);
  });
});

describe("describeDeletionBanner", () => {
  it("returns shown:false when deletedAt is null", () => {
    const b = describeDeletionBanner(null);
    expect(b.shown).toBe(false);
    expect(b.message).toBeNull();
  });

  it("returns daysRemaining + a human message during the grace window", () => {
    const deletedAt = new Date("2026-05-01T00:00:00Z");
    const now = new Date("2026-05-15T00:00:00Z"); // 14 days into the 30-day window
    const b = describeDeletionBanner(deletedAt, now);
    expect(b.shown).toBe(true);
    expect(b.daysRemaining).toBe(16);
    expect(b.message).toMatch(/16 days/);
  });

  it("uses singular 'day' phrasing when 1 day remains", () => {
    const deletedAt = new Date("2026-05-01T00:00:00Z");
    const now = new Date("2026-05-30T00:00:00Z"); // 29 days in -> 1 day left
    const b = describeDeletionBanner(deletedAt, now);
    expect(b.daysRemaining).toBe(1);
    expect(b.message).toMatch(/1 day(?! )/);
  });

  it("collapses to a final-message when daysRemaining hits 0", () => {
    const deletedAt = new Date("2026-05-01T00:00:00Z");
    const now = new Date("2026-06-15T00:00:00Z"); // well past grace
    const b = describeDeletionBanner(deletedAt, now);
    expect(b.daysRemaining).toBe(0);
    expect(b.message).toMatch(/permanent deletion/i);
    expect(b.message).toMatch(/contact support/i);
  });
});
