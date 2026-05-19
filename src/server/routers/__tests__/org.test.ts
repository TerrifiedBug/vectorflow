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
    denyInDemo: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

const auditMocks = vi.hoisted(() => ({ writeAuditLog: vi.fn() }));
vi.mock("@/server/services/audit", () => ({
  writeAuditLog: auditMocks.writeAuditLog,
}));

import { prisma } from "@/lib/prisma";
import { orgRouter } from "../org";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const callerFactory = t.createCallerFactory(orgRouter);

function setupTransactionMock() {
  prismaMock.$executeRaw.mockResolvedValue(1 as never);
  prismaMock.$transaction.mockImplementation(
    async (fn: (tx: PrismaClient) => Promise<unknown>) => fn(prismaMock),
  );
}

function ownerCaller() {
  return callerFactory({
    session: { user: { id: "owner-1", email: "owner@example.test" } },
    organizationId: "org-a",
    orgMemberRole: "OWNER",
  });
}

function adminCaller() {
  return callerFactory({
    session: { user: { id: "admin-1", email: "admin@example.test" } },
    organizationId: "org-a",
    orgMemberRole: "ADMIN",
  });
}

beforeEach(() => {
  mockReset(prismaMock);
  setupTransactionMock();
  auditMocks.writeAuditLog.mockReset();
  auditMocks.writeAuditLog.mockResolvedValue(undefined);
});

describe("org.transferOwnership", () => {
  it("rejects callers who are not the current OWNER", async () => {
    await expect(
      adminCaller().transferOwnership({ toUserId: "user-2" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prismaMock.orgMember.update).not.toHaveBeenCalled();
  });

  it("rejects transferring to yourself", async () => {
    await expect(
      ownerCaller().transferOwnership({ toUserId: "owner-1" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/yourself/i),
    });
    expect(prismaMock.orgMember.update).not.toHaveBeenCalled();
  });

  it("rejects when the target is not already an OrgMember", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue(null);
    await expect(
      ownerCaller().transferOwnership({ toUserId: "stranger" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/not a member/i),
    });
    expect(prismaMock.orgMember.update).not.toHaveBeenCalled();
  });

  it("rejects when the caller is no longer OWNER inside the transaction (race)", async () => {
    prismaMock.orgMember.findUnique
      .mockResolvedValueOnce({ id: "m-2", role: "ADMIN" } as never) // target lookup
      .mockResolvedValueOnce({ role: "ADMIN" } as never); // re-read of caller
    await expect(
      ownerCaller().transferOwnership({ toUserId: "user-2" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringMatching(/no longer the OWNER/i),
    });
    expect(prismaMock.orgMember.update).not.toHaveBeenCalled();
  });

  it("demotes the caller and promotes the target in a single transaction", async () => {
    prismaMock.orgMember.findUnique
      .mockResolvedValueOnce({ id: "m-2", role: "ADMIN" } as never) // target
      .mockResolvedValueOnce({ role: "OWNER" } as never); // self
    prismaMock.orgMember.update.mockResolvedValue({} as never);

    const result = await ownerCaller().transferOwnership({ toUserId: "user-2" });

    expect(result).toEqual({
      id: "org-a",
      fromUserId: "owner-1",
      toUserId: "user-2",
    });

    // Two updates inside the same $transaction call.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.orgMember.update).toHaveBeenCalledTimes(2);
    const [demote, promote] = prismaMock.orgMember.update.mock.calls;
    expect(demote[0]).toMatchObject({
      where: {
        userId_organizationId: { userId: "owner-1", organizationId: "org-a" },
      },
      data: { role: "ADMIN" },
    });
    expect(promote[0]).toMatchObject({
      where: {
        userId_organizationId: { userId: "user-2", organizationId: "org-a" },
      },
      data: { role: "OWNER" },
    });
  });

  it("validates toUserId shape", async () => {
    await expect(
      ownerCaller().transferOwnership({ toUserId: "" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      ownerCaller().transferOwnership({ toUserId: "has spaces" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─── Domain-claim procedures ───────────────────────────────────────────────

import { _setDomainClaimDnsResolverForTests } from "../org";

function stubResolver(records: string[][] | Error) {
  const resolveTxt = vi.fn(async (_host: string): Promise<string[][]> => {
    if (records instanceof Error) throw records;
    return records;
  });
  _setDomainClaimDnsResolverForTests({ resolveTxt });
  return resolveTxt;
}

describe("org.claimDomain", () => {
  beforeEach(() => {
    _setDomainClaimDnsResolverForTests(null);
  });

  it("rejects non-OWNER callers", async () => {
    await expect(
      adminCaller().claimDomain({ domain: "acme.test" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prismaMock.organizationDomainClaim.upsert).not.toHaveBeenCalled();
  });

  it("rejects obviously-malformed domains", async () => {
    for (const bad of ["not a domain", "http://acme.com/path", "acme:80"]) {
      await expect(
        ownerCaller().claimDomain({ domain: bad }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(prismaMock.organizationDomainClaim.upsert).not.toHaveBeenCalled();
  });

  it("upserts a fresh token and returns the TXT instructions", async () => {
    prismaMock.organizationDomainClaim.upsert.mockResolvedValue({
      id: "claim-1",
      organizationId: "org-a",
      domain: "acme.test",
      verificationToken: "tok-deadbeef",
      verifiedAt: null,
      lastCheckedAt: null,
      lastCheckError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const result = await ownerCaller().claimDomain({ domain: "ACME.test." });

    expect(result.domain).toBe("acme.test");
    expect(result.instructions.host).toBe("_vectorflow.acme.test");
    expect(result.instructions.type).toBe("TXT");
    expect(result.instructions.value.startsWith("vf-verify=")).toBe(true);
    expect(prismaMock.organizationDomainClaim.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_domain: { organizationId: "org-a", domain: "acme.test" },
        },
        update: expect.objectContaining({
          verifiedAt: null,
          lastCheckedAt: null,
          lastCheckError: null,
        }),
      }),
    );
  });
});

describe("org.verifyDomain", () => {
  const claimRow = {
    id: "claim-1",
    organizationId: "org-a",
    domain: "acme.test",
    verificationToken: "tok-deadbeef",
  };

  beforeEach(() => {
    _setDomainClaimDnsResolverForTests(null);
  });

  it("rejects MEMBER callers", async () => {
    const member = callerFactory({
      session: { user: { id: "u-1" } },
      organizationId: "org-a",
      orgMemberRole: "MEMBER",
    });
    await expect(
      member.verifyDomain({ id: "claim-1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("404s on a claim from another org", async () => {
    prismaMock.organizationDomainClaim.findUnique.mockResolvedValue({
      ...claimRow,
      organizationId: "org-b",
    } as never);
    await expect(
      ownerCaller().verifyDomain({ id: "claim-1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("records lastCheckError and returns verified=false on DNS failure", async () => {
    prismaMock.organizationDomainClaim.findUnique.mockResolvedValue(claimRow as never);
    prismaMock.organizationDomainClaim.update.mockResolvedValue({
      id: "claim-1",
      verifiedAt: null,
      lastCheckError: "NXDOMAIN: no TXT records at _vectorflow.acme.test",
    } as never);
    stubResolver(Object.assign(new Error("nope"), { code: "ENOTFOUND" }));

    const result = await ownerCaller().verifyDomain({ id: "claim-1" });

    expect(result).toMatchObject({ verified: false });
    expect(prismaMock.organizationDomainClaim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "claim-1" },
        data: expect.objectContaining({
          lastCheckError: expect.stringMatching(/NXDOMAIN/),
        }),
      }),
    );
  });

  it("sets verifiedAt and returns verified=true on a matching TXT record", async () => {
    prismaMock.organizationDomainClaim.findUnique.mockResolvedValue(claimRow as never);
    prismaMock.organizationDomainClaim.findFirst.mockResolvedValue(null);
    prismaMock.organizationDomainClaim.update.mockResolvedValue({
      id: "claim-1",
      verifiedAt: new Date(),
    } as never);
    stubResolver([["vf-verify=tok-deadbeef"]]);

    const result = await ownerCaller().verifyDomain({ id: "claim-1" });

    expect(result).toEqual({ id: "claim-1", verified: true });
    expect(prismaMock.organizationDomainClaim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verifiedAt: expect.any(Date),
          lastCheckError: null,
        }),
      }),
    );
  });

  it("CONFLICTs when another org already verified the same domain", async () => {
    prismaMock.organizationDomainClaim.findUnique.mockResolvedValue(claimRow as never);
    prismaMock.organizationDomainClaim.findFirst.mockResolvedValue({
      id: "claim-2",
      organizationId: "org-other",
    } as never);
    stubResolver([["vf-verify=tok-deadbeef"]]);

    await expect(
      ownerCaller().verifyDomain({ id: "claim-1" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("org.listDomains", () => {
  it("rejects MEMBER callers", async () => {
    const member = callerFactory({
      session: { user: { id: "u-1" } },
      organizationId: "org-a",
      orgMemberRole: "MEMBER",
    });
    await expect(member.listDomains()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns claims scoped to the caller's organisation", async () => {
    prismaMock.organizationDomainClaim.findMany.mockResolvedValue([
      {
        id: "claim-1",
        domain: "acme.test",
        verifiedAt: null,
        lastCheckedAt: null,
        lastCheckError: null,
        createdAt: new Date(),
      },
    ] as never);
    const result = await ownerCaller().listDomains();
    expect(result).toHaveLength(1);
    expect(prismaMock.organizationDomainClaim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-a" },
      }),
    );
  });
});

describe("org.unclaimDomain", () => {
  it("rejects non-OWNER callers", async () => {
    await expect(
      adminCaller().unclaimDomain({ id: "claim-1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("404s on a claim from another org", async () => {
    prismaMock.organizationDomainClaim.findUnique.mockResolvedValue({
      id: "claim-1",
      organizationId: "org-b",
    } as never);
    await expect(
      ownerCaller().unclaimDomain({ id: "claim-1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deletes the row when scoped correctly", async () => {
    prismaMock.organizationDomainClaim.findUnique.mockResolvedValue({
      id: "claim-1",
      organizationId: "org-a",
    } as never);
    prismaMock.organizationDomainClaim.delete.mockResolvedValue({} as never);

    const result = await ownerCaller().unclaimDomain({ id: "claim-1" });

    expect(result).toEqual({ id: "claim-1", removed: true });
    expect(prismaMock.organizationDomainClaim.delete).toHaveBeenCalledWith({
      where: { id: "claim-1" },
    });
  });
});

describe("org.resetMemberMfa", () => {
  it("rejects non-OWNER callers", async () => {
    await expect(
      adminCaller().resetMemberMfa({ targetUserId: "user-2" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses self-reset", async () => {
    await expect(
      ownerCaller().resetMemberMfa({ targetUserId: "owner-1" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/cannot reset your own MFA/i),
    });
  });

  it("404s when target is not a member of the caller's org", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue(null);
    await expect(
      ownerCaller().resetMemberMfa({ targetUserId: "user-2" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("clears totp state on the target and returns audit-shaped output", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue({ id: "m-2" } as never);
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-2",
      totpEnabled: true,
    } as never);
    prismaMock.user.update.mockResolvedValue({} as never);

    const result = await ownerCaller().resetMemberMfa({ targetUserId: "user-2" });

    expect(result).toEqual({
      id: "user-2",
      targetUserId: "user-2",
      wasEnabled: true,
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-2" },
      data: {
        totpEnabled: false,
        totpSecret: null,
        totpBackupCodes: null,
      },
    });
  });
});
