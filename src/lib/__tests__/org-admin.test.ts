import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

import { prisma } from "@/lib/prisma";
import { isOrgWideAdmin } from "../org-admin";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
});

describe("isOrgWideAdmin", () => {
  it("returns false when userId is missing", async () => {
    expect(await isOrgWideAdmin(null, "org-a")).toBe(false);
    expect(await isOrgWideAdmin(undefined, "org-a")).toBe(false);
    expect(prismaMock.orgMember.findUnique).not.toHaveBeenCalled();
  });

  it("returns false when there is no OrgMember row", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue(null);
    expect(await isOrgWideAdmin("user-1", "org-a")).toBe(false);
  });

  it("returns false for MEMBER role", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue({ role: "MEMBER" } as never);
    expect(await isOrgWideAdmin("user-1", "org-a")).toBe(false);
  });

  it("returns true for ADMIN role", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue({ role: "ADMIN" } as never);
    expect(await isOrgWideAdmin("user-1", "org-a")).toBe(true);
  });

  it("returns true for OWNER role", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue({ role: "OWNER" } as never);
    expect(await isOrgWideAdmin("user-1", "org-a")).toBe(true);
  });

  it("defaults to DEFAULT_ORG_ID when organisationId is omitted", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue({ role: "OWNER" } as never);
    await isOrgWideAdmin("user-1");
    expect(prismaMock.orgMember.findUnique).toHaveBeenCalledWith({
      where: {
        userId_organizationId: { userId: "user-1", organizationId: "default" },
      },
      select: { role: true },
    });
  });
});
