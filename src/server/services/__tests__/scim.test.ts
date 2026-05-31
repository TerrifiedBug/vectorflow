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
