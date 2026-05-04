import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

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
import { scimCreateUser } from "@/server/services/scim";

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

    await scimCreateUser({
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
      scimCreateUser({
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
          error: expect.stringContaining("cannot be adopted via SCIM"),
        }),
      }),
    );
  });

  it("preserves the adoption action when a SCIM user adoption fails", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "ada@example.com",
      name: "Ada Lovelace",
      scimExternalId: null,
      lockedAt: null,
      authMethod: "OIDC",
    } as never);
    prismaMock.user.update.mockRejectedValue(new Error("adoption failed") as never);

    await expect(
      scimCreateUser({
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
          error: "adoption failed",
        }),
      }),
    );
  });
});
