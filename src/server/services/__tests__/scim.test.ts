import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

vi.mock("@/server/services/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/server/services/event-alerts", () => ({
  fireEventAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/logger", () => ({
  debugLog: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
import {
  scimCreateUser,
  scimUpdateUser,
  scimPatchUser,
  scimDeleteUser,
  scimGetUser,
  scimListUsers,
  ScimProtectedMemberError,
} from "@/server/services/scim";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const writeAuditLogMock = vi.mocked(writeAuditLog);

beforeEach(() => {
  mockReset(prismaMock);
  writeAuditLogMock.mockClear();
});

describe("SCIM audit status logging", () => {
  it("marks successful SCIM user creation audit events as success", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: "user-1",
      email: "ada@example.com",
      name: "Ada Lovelace",
      scimExternalId: "ext-1",
      lockedAt: null,
    } as never);

    await scimCreateUser("org-1", {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: "ada@example.com",
      externalId: "ext-1",
      name: { formatted: "Ada Lovelace" },
      emails: [{ value: "ada@example.com", primary: true, type: "work" }],
    });

    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "scim.user_created",
        metadata: expect.objectContaining({
          email: "ada@example.com",
          scimExternalId: "ext-1",
          status: "success",
          organizationId: "org-1",
        }),
      }),
    );
  });

  it("logs local-account SCIM adoption conflicts before rethrowing", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "ada@example.com",
      name: "Ada Lovelace",
      scimExternalId: null,
      lockedAt: null,
      authMethod: "LOCAL",
    } as never);

    await expect(
      scimCreateUser("org-1", {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: "ada@example.com",
        externalId: "ext-1",
        emails: [{ value: "ada@example.com", primary: true, type: "work" }],
      }),
    ).rejects.toThrow("cannot be adopted via SCIM");

    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "scim.user_adopted",
        entityType: "ScimUser",
        entityId: "ada@example.com",
        metadata: expect.objectContaining({
          email: "ada@example.com",
          scimExternalId: "ext-1",
          status: "failure",
          organizationId: "org-1",
          error: expect.stringContaining("cannot be adopted via SCIM"),
        }),
      }),
    );
  });

  it("preserves the adoption action when the SCIM user.update fails after the cross-org guard passes", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "ada@example.com",
      name: "Ada Lovelace",
      scimExternalId: null,
      lockedAt: null,
      authMethod: "OIDC",
    } as never);
    // Cross-org guard expects the existing User to already be a
    // member of this org. With the OrgMember row present, the guard
    // passes and the user.update path runs — which we make throw.
    prismaMock.orgMember.findUnique.mockResolvedValue({ userId: "user-1" } as never);
    prismaMock.user.update.mockRejectedValue(new Error("adoption failed") as never);

    await expect(
      scimCreateUser("org-1", {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: "ada@example.com",
        externalId: "ext-1",
        emails: [{ value: "ada@example.com", primary: true, type: "work" }],
      }),
    ).rejects.toThrow("adoption failed");

    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "scim.user_adopted",
        entityType: "ScimUser",
        entityId: "ada@example.com",
        metadata: expect.objectContaining({
          email: "ada@example.com",
          scimExternalId: "ext-1",
          status: "failure",
          organizationId: "org-1",
          error: "adoption failed",
        }),
      }),
    );
  });

  it("refuses cross-org adoption when the existing user is not yet a member of this org", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-from-other-org",
      email: "ada@example.com",
      name: "Ada Lovelace",
      scimExternalId: null,
      lockedAt: null,
      authMethod: "OIDC",
    } as never);
    // No membership in the target org → cross-org guard refuses.
    prismaMock.orgMember.findUnique.mockResolvedValue(null);

    await expect(
      scimCreateUser("org-attacker", {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: "ada@example.com",
        emails: [{ value: "ada@example.com", primary: true, type: "work" }],
      }),
    ).rejects.toThrow("already exists in another organisation");

    // user.update / orgMember.upsert MUST NOT be called — the guard
    // bailed before any write.
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe("SCIM cross-tenant isolation", () => {
  it("scimGetUser returns null for users not in the caller's org", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    const result = await scimGetUser("org-A", "user-from-org-B");
    expect(result).toBeNull();
    // The query MUST filter by OrgMember to prevent existence leak.
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "user-from-org-B",
          orgMemberships: { some: { organizationId: "org-A" } },
        }),
      }),
    );
  });

  it("scimListUsers filters by OrgMember in the caller's org", async () => {
    prismaMock.user.findMany.mockResolvedValue([] as never);
    prismaMock.user.count.mockResolvedValue(0 as never);
    await scimListUsers("org-A");
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgMemberships: { some: { organizationId: "org-A" } },
        }),
      }),
    );
  });

  it("scimUpdateUser returns null when caller is not a member of the user's org", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue(null);
    const result = await scimUpdateUser("org-A", "user-from-org-B", {
      name: { formatted: "Mallory" },
    });
    expect(result).toBeNull();
    // Update MUST NOT be attempted on the global User row.
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("scimPatchUser returns null when caller is not a member of the user's org", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue(null);
    const result = await scimPatchUser("org-A", "user-from-org-B", [
      { op: "replace", path: "active", value: false },
    ]);
    expect(result).toBeNull();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("scimDeleteUser returns null when caller is not a member of the user's org", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue(null);
    const result = await scimDeleteUser("org-A", "user-from-org-B");
    expect(result).toBeNull();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe("SCIM/local coexistence", () => {
  it("tags SCIM-provisioned memberships with provisionedVia=SCIM", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: "user-1",
      email: "ada@example.com",
      name: "Ada",
      scimExternalId: "ext-1",
      lockedAt: null,
    } as never);

    await scimCreateUser("org-1", {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: "ada@example.com",
      externalId: "ext-1",
      emails: [{ value: "ada@example.com", primary: true, type: "work" }],
    });

    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orgMemberships: {
            create: expect.objectContaining({
              organizationId: "org-1",
              role: "MEMBER",
              provisionedVia: "SCIM",
            }),
          },
        }),
      }),
    );
  });

  it("refuses to deprovision a LOCAL member and leaves the row intact", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue({
      role: "MEMBER",
      provisionedVia: "LOCAL",
    } as never);

    const err = await scimDeleteUser("org-1", "local-user").catch((e) => e);
    expect(err).toBeInstanceOf(ScimProtectedMemberError);
    expect(err.reason).toBe("local_member");
    expect(prismaMock.orgMember.delete).not.toHaveBeenCalled();
  });

  it("refuses to deprovision the OWNER even when SCIM-provisioned", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue({
      role: "OWNER",
      provisionedVia: "SCIM",
    } as never);

    const err = await scimDeleteUser("org-1", "owner-user").catch((e) => e);
    expect(err).toBeInstanceOf(ScimProtectedMemberError);
    expect(err.reason).toBe("owner");
    expect(prismaMock.orgMember.delete).not.toHaveBeenCalled();
  });

  it("deprovisions a SCIM-provisioned non-owner member", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue({
      role: "MEMBER",
      provisionedVia: "SCIM",
    } as never);
    // withOrgTx runs its callback against the (mocked) transaction client.
    prismaMock.$transaction.mockImplementation(
      (async (cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock)) as never,
    );
    prismaMock.teamMember.deleteMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.orgMember.delete.mockResolvedValue({} as never);
    prismaMock.orgMember.count.mockResolvedValue(1 as never);

    const result = await scimDeleteUser("org-1", "scim-user");

    expect(result).toEqual({ ok: true });
    expect(prismaMock.orgMember.delete).toHaveBeenCalledWith({
      where: {
        userId_organizationId: { userId: "scim-user", organizationId: "org-1" },
      },
    });
    // Still a member of another org (count=1) → global user is NOT locked.
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
