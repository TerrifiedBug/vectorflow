import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));

import { prisma } from "@/lib/prisma";
import {
  computeSuiteRole,
  resolveSuiteRole,
} from "@/server/services/auth/suite-role";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

describe("computeSuiteRole", () => {
  it.each([
    // org OWNER/ADMIN always wins -> admin
    ["OWNER", [], "admin"],
    ["ADMIN", [], "admin"],
    ["OWNER", ["VIEWER"], "admin"],
    // else any team EDITOR/ADMIN -> editor
    ["MEMBER", ["EDITOR"], "editor"],
    ["MEMBER", ["ADMIN"], "editor"],
    ["MEMBER", ["VIEWER", "EDITOR"], "editor"],
    [null, ["ADMIN"], "editor"],
    // else -> viewer
    ["MEMBER", ["VIEWER"], "viewer"],
    ["MEMBER", [], "viewer"],
    [null, [], "viewer"],
    [undefined, [], "viewer"],
  ] as const)("orgRole=%s teamRoles=%j -> %s", (orgRole, teamRoles, expected) => {
    expect(computeSuiteRole(orgRole, [...teamRoles])).toBe(expected);
  });
});

describe("resolveSuiteRole", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("resolves admin from an org OWNER membership (scoped to the org)", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue({ role: "OWNER" } as never);
    prismaMock.teamMember.findMany.mockResolvedValue([] as never);

    await expect(resolveSuiteRole("u1", "default")).resolves.toBe("admin");
    expect(prismaMock.orgMember.findUnique).toHaveBeenCalledWith({
      where: { userId_organizationId: { userId: "u1", organizationId: "default" } },
      select: { role: true },
    });
  });

  it("resolves editor for a plain MEMBER with a team EDITOR role", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue({ role: "MEMBER" } as never);
    prismaMock.teamMember.findMany.mockResolvedValue(
      [{ role: "VIEWER" }, { role: "EDITOR" }] as never,
    );

    await expect(resolveSuiteRole("u2", "default")).resolves.toBe("editor");
    expect(prismaMock.teamMember.findMany).toHaveBeenCalledWith({
      where: { userId: "u2" },
      select: { role: true },
    });
  });

  it("defaults to viewer when the user has no org or team memberships", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue(null);
    prismaMock.teamMember.findMany.mockResolvedValue([] as never);

    await expect(resolveSuiteRole("u3", "default")).resolves.toBe("viewer");
  });
});
