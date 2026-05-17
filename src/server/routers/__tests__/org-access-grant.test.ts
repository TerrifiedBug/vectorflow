import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { t } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return { t };
});

vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(
      ({
        next,
        ctx,
      }: {
        next: (opts: { ctx: unknown }) => unknown;
        ctx: unknown;
      }) => next({ ctx }),
    );
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    withTeamAccess: passthrough,
    requireSuperAdmin: passthrough,
    requirePlatformOperator: passthrough,
    denyInDemo: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

const grantMocks = vi.hoisted(() => ({
  approveOrgAccessGrant: vi.fn(),
  revokeOrgAccessGrant: vi.fn(),
  listOrgAccessGrantsForOrg: vi.fn(),
}));

vi.mock("@/server/services/org-access-grant", () => ({
  approveOrgAccessGrant: grantMocks.approveOrgAccessGrant,
  revokeOrgAccessGrant: grantMocks.revokeOrgAccessGrant,
  listOrgAccessGrantsForOrg: grantMocks.listOrgAccessGrantsForOrg,
}));

// Mock writeAuditLog — it's fire-and-forget in the router so we only
// need to verify it was called with the right args, not its side effects.
const auditMocks = vi.hoisted(() => ({ writeAuditLog: vi.fn() }));
vi.mock("@/server/services/audit", () => ({
  writeAuditLog: auditMocks.writeAuditLog,
}));

import { prisma } from "@/lib/prisma";
import { orgAccessGrantRouter } from "../org-access-grant";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const callerFactory = t.createCallerFactory(orgAccessGrantRouter);

// Make $executeRaw and $transaction cooperative so withOrgTx works in tests.
// withOrgTx wraps DB work in prisma.$transaction — we call the callback with
// the same mock client so all model mocks remain accessible inside the tx.
function setupTransactionMock() {
  prismaMock.$executeRaw.mockResolvedValue(1 as never);
  prismaMock.$transaction.mockImplementation(
    async (fn: (tx: PrismaClient) => Promise<unknown>) => fn(prismaMock),
  );
}

function caller(role: "OWNER" | "ADMIN" | "MEMBER" = "OWNER") {
  prismaMock.orgMember.findUnique.mockResolvedValue({
    role,
    organization: { suspendedAt: null, deletedAt: null },
  } as never);
  return callerFactory({
    session: { user: { id: "u-1", email: "owner@example.test" } },
  });
}

beforeEach(() => {
  mockReset(prismaMock);
  setupTransactionMock();
  auditMocks.writeAuditLog.mockReset();
  auditMocks.writeAuditLog.mockResolvedValue(undefined);
  Object.values(grantMocks).forEach((m) =>
    "mockReset" in m ? m.mockReset() : null,
  );
});

describe("orgAccessGrant.list", () => {
  it("returns grants for an ADMIN caller", async () => {
    grantMocks.listOrgAccessGrantsForOrg.mockResolvedValue([]);
    await caller("ADMIN").list({ organizationId: "org-a", limit: 25 });
    expect(grantMocks.listOrgAccessGrantsForOrg).toHaveBeenCalledWith(
      "org-a",
      { limit: 25 },
    );
  });

  it("rejects MEMBER role with FORBIDDEN", async () => {
    await expect(
      caller("MEMBER").list({ organizationId: "org-a", limit: 25 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects non-member with FORBIDDEN", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue(null);
    await expect(
      callerFactory({
        session: { user: { id: "u-1", email: "x@example.test" } },
      }).list({ organizationId: "org-a", limit: 25 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("orgAccessGrant.approve", () => {
  it("approves a pending grant + fires writeAuditLog", async () => {
    prismaMock.orgAccessGrant.findUnique.mockResolvedValue({
      id: "grant-1",
      organizationId: "org-a",
      approvedByCustomerAdminId: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h from now
    } as never);
    grantMocks.approveOrgAccessGrant.mockResolvedValue({
      id: "grant-1",
      operatorId: "op-2",
      expiresAt: new Date("2026-05-17T13:00:00Z"),
    });

    const r = await caller("ADMIN").approve({
      grantId: "grant-1",
      organizationId: "org-a",
    });
    expect(r.id).toBe("grant-1");
    expect(grantMocks.approveOrgAccessGrant).toHaveBeenCalledWith({
      grantId: "grant-1",
      approvedByCustomerAdminId: "u-1",
    });
    // writeAuditLog is used (not prisma.auditLog.create) for chain inclusion.
    expect(auditMocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.grant_approved",
        organizationId: "org-a",
        userId: "u-1",
        entityType: "OrgAccessGrant",
        entityId: "grant-1",
      }),
    );
  });

  it("rejects approving a grant for a different org with FORBIDDEN", async () => {
    prismaMock.orgAccessGrant.findUnique.mockResolvedValue({
      id: "grant-1",
      organizationId: "org-OTHER",
      approvedByCustomerAdminId: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    } as never);
    await expect(
      caller("ADMIN").approve({ grantId: "grant-1", organizationId: "org-a" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(grantMocks.approveOrgAccessGrant).not.toHaveBeenCalled();
  });

  it("rejects double-approval with CONFLICT", async () => {
    prismaMock.orgAccessGrant.findUnique.mockResolvedValue({
      id: "grant-1",
      organizationId: "org-a",
      approvedByCustomerAdminId: "u-prev",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    } as never);
    await expect(
      caller("ADMIN").approve({ grantId: "grant-1", organizationId: "org-a" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects approving a revoked grant with CONFLICT", async () => {
    prismaMock.orgAccessGrant.findUnique.mockResolvedValue({
      id: "grant-1",
      organizationId: "org-a",
      approvedByCustomerAdminId: null,
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    } as never);
    await expect(
      caller("ADMIN").approve({ grantId: "grant-1", organizationId: "org-a" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects approving an expired grant with CONFLICT", async () => {
    prismaMock.orgAccessGrant.findUnique.mockResolvedValue({
      id: "grant-1",
      organizationId: "org-a",
      approvedByCustomerAdminId: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000), // expired
    } as never);
    await expect(
      caller("ADMIN").approve({ grantId: "grant-1", organizationId: "org-a" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects approving a missing grant with NOT_FOUND", async () => {
    prismaMock.orgAccessGrant.findUnique.mockResolvedValue(null);
    await expect(
      caller("ADMIN").approve({ grantId: "missing", organizationId: "org-a" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("orgAccessGrant.revoke", () => {
  it("revokes an active grant when caller is OWNER + fires writeAuditLog", async () => {
    prismaMock.orgAccessGrant.findUnique.mockResolvedValue({
      id: "grant-1",
      organizationId: "org-a",
      revokedAt: null,
    } as never);
    grantMocks.revokeOrgAccessGrant.mockResolvedValue({
      id: "grant-1",
      operatorId: "op-2",
      revokedAt: new Date(),
    });
    await caller("OWNER").revoke({
      grantId: "grant-1",
      organizationId: "org-a",
    });
    expect(grantMocks.revokeOrgAccessGrant).toHaveBeenCalledWith("grant-1");
    expect(auditMocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.grant_revoked",
        organizationId: "org-a",
      }),
    );
  });

  it("rejects ADMIN role on revoke (OWNER-only)", async () => {
    await expect(
      caller("ADMIN").revoke({ grantId: "grant-1", organizationId: "org-a" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects revoking an already-revoked grant with CONFLICT", async () => {
    prismaMock.orgAccessGrant.findUnique.mockResolvedValue({
      id: "grant-1",
      organizationId: "org-a",
      revokedAt: new Date(),
    } as never);
    await expect(
      caller("OWNER").revoke({ grantId: "grant-1", organizationId: "org-a" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
