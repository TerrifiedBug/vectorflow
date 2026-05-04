import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/scim", () => ({
  fireScimSyncFailedAlert: vi.fn().mockResolvedValue(undefined),
  writeScimAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../auth", () => ({
  authenticateScim: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/logger", () => ({
  debugLog: vi.fn(),
}));

vi.mock("@/server/services/group-mappings", () => ({
  reconcileUserTeamMemberships: vi.fn().mockResolvedValue(undefined),
  getScimGroupNamesForUser: vi.fn().mockResolvedValue([]),
}));

import { prisma } from "@/lib/prisma";
import { writeScimAuditLog } from "@/server/services/scim";
import { POST } from "../route";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const writeScimAuditLogMock = vi.mocked(writeScimAuditLog);

function scimRequest(body: unknown) {
  return new Request("https://example.com/api/scim/v2/Groups", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  mockReset(prismaMock);
  writeScimAuditLogMock.mockClear();
});

describe("SCIM Groups POST audit status logging", () => {
  it("preserves the group adoption action when POST adoption fails", async () => {
    prismaMock.$transaction.mockImplementation(async (callback) => {
      const tx = mockDeep<PrismaClient>();
      tx.scimGroup.findUnique.mockResolvedValue({
        id: "group-1",
        displayName: "Engineering",
        externalId: "old-ext",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
      tx.scimGroup.update.mockRejectedValue(new Error("adoption failed") as never);
      return callback(tx);
    });

    const response = await POST(
      scimRequest({
        displayName: "Engineering",
        externalId: "new-ext",
      }) as never,
    );

    expect(response.status).toBe(400);
    expect(writeScimAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "scim.group_adopted",
        entityType: "ScimGroup",
        entityId: "Engineering",
        metadata: expect.objectContaining({
          displayName: "Engineering",
        }),
        status: "failure",
        error: expect.objectContaining({ message: "adoption failed" }),
      }),
    );
  });
});
