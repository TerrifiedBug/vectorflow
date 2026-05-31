/**
 * Host-to-org resolution for per-org OIDC.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

import { prisma } from "@/lib/prisma";
import {
  extractSlugFromHost,
  normalizeHost,
  resolveOrgIdFromHost,
} from "@/lib/host-to-org";
import { DEFAULT_ORG_ID } from "@/lib/org-constants";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeHost", () => {
  it("strips port from a name:port host", () => {
    expect(normalizeHost("acme.vectorflow.sh:443")).toBe("acme.vectorflow.sh");
  });

  it("strips IPv6 brackets and port", () => {
    expect(normalizeHost("[::1]:3000")).toBe("::1");
    expect(normalizeHost("[2001:db8::1]:8080")).toBe("2001:db8::1");
  });

  it("returns the host unchanged when there is no port", () => {
    expect(normalizeHost("acme.vectorflow.sh")).toBe("acme.vectorflow.sh");
  });

  it("trims whitespace", () => {
    expect(normalizeHost("  acme.vectorflow.sh:443  ")).toBe("acme.vectorflow.sh");
  });
});

describe("extractSlugFromHost", () => {
  it("returns the first label for a multi-label host", () => {
    expect(extractSlugFromHost("acme.vectorflow.sh")).toBe("acme");
    expect(extractSlugFromHost("acme-co.vectorflow.sh")).toBe("acme-co");
  });

  it("returns null for single-label hosts (localhost, intranet)", () => {
    expect(extractSlugFromHost("localhost")).toBeNull();
    expect(extractSlugFromHost("intranet")).toBeNull();
  });

  it("returns null when the first label is not a syntactically valid slug", () => {
    // Starts with a digit
    expect(extractSlugFromHost("123.vectorflow.sh")).toBeNull();
    // Too short
    expect(extractSlugFromHost("ab.vectorflow.sh")).toBeNull();
    // Uppercase letters in the label — covered by isValidOrgSlug grammar
    // (slugs are lowercase). `extractSlugFromHost` lowercases first.
    expect(extractSlugFromHost("ACME.vectorflow.sh")).toBe("acme");
  });

  it("returns null for bare IPv4 / IPv6 literals", () => {
    expect(extractSlugFromHost("127.0.0.1")).toBeNull();
    // IPv6 is single-label after bracket-strip (`::1`).
    expect(extractSlugFromHost("::1")).toBeNull();
  });
});

describe("resolveOrgIdFromHost", () => {
  it("returns DEFAULT_ORG_ID when host is null/undefined/empty", async () => {
    await expect(resolveOrgIdFromHost(null)).resolves.toBe(DEFAULT_ORG_ID);
    await expect(resolveOrgIdFromHost(undefined)).resolves.toBe(DEFAULT_ORG_ID);
    await expect(resolveOrgIdFromHost("")).resolves.toBe(DEFAULT_ORG_ID);
  });

  it("returns DEFAULT_ORG_ID when host has no slug prefix (OSS)", async () => {
    await expect(resolveOrgIdFromHost("localhost:3000")).resolves.toBe(
      DEFAULT_ORG_ID,
    );
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
  });

  it("returns the matched org id for a valid slug", async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      id: "org-acme-uuid",
    } as never);

    await expect(
      resolveOrgIdFromHost("acme.vectorflow.sh:443"),
    ).resolves.toBe("org-acme-uuid");
    expect(prismaMock.organization.findUnique).toHaveBeenCalledWith({
      where: { slug: "acme" },
      select: { id: true },
    });
  });

  it("returns DEFAULT_ORG_ID when the slug does not exist in the DB", async () => {
    prismaMock.organization.findUnique.mockResolvedValue(null);
    await expect(resolveOrgIdFromHost("ghost.vectorflow.sh")).resolves.toBe(
      DEFAULT_ORG_ID,
    );
  });

  it("fails open to DEFAULT_ORG_ID when the DB is unreachable", async () => {
    prismaMock.organization.findUnique.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(resolveOrgIdFromHost("acme.vectorflow.sh")).resolves.toBe(
      DEFAULT_ORG_ID,
    );
  });

  it("cross-tenant isolation: slugA host never resolves to org B's id", async () => {
    prismaMock.organization.findUnique.mockImplementation(((args: {
      where: { slug: string };
    }) => {
      if (args.where.slug === "tenant-a") {
        return Promise.resolve({ id: "org-a-uuid" } as never);
      }
      if (args.where.slug === "tenant-b") {
        return Promise.resolve({ id: "org-b-uuid" } as never);
      }
      return Promise.resolve(null);
    }) as never);

    await expect(resolveOrgIdFromHost("tenant-a.vectorflow.sh")).resolves.toBe(
      "org-a-uuid",
    );
    await expect(resolveOrgIdFromHost("tenant-b.vectorflow.sh")).resolves.toBe(
      "org-b-uuid",
    );
  });
});
