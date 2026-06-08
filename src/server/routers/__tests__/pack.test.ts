import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { t } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return { t };
});

vi.mock("@/trpc/init", () => ({
  router: t.router,
  protectedProcedure: t.procedure,
}));

vi.mock("@/lib/prisma", () => {
  const __pm = mockDeep<PrismaClient>();
  return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
});

import { prisma } from "@/lib/prisma";
import { packRouter } from "@/server/routers/pack";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(packRouter)({
  session: { user: { id: "user-1" } },
  organizationId: "org-1",
});

const NOW = new Date("2026-06-08T12:00:00Z");

function makePack(
  overrides: Partial<{
    id: string;
    organizationId: string;
    name: string;
    featured: boolean;
    templates: Array<{ id: string; name: string; description: string; category: string }>;
  }> = {},
) {
  return {
    id: overrides.id ?? "pack-data-protection",
    organizationId: overrides.organizationId ?? "default",
    name: overrides.name ?? "Data Protection Pack",
    description: "Compliance-grade DLP transforms",
    category: "Data Protection",
    icon: "Shield",
    featured: overrides.featured ?? true,
    createdAt: NOW,
    updatedAt: NOW,
    templates:
      overrides.templates ?? [
        {
          id: "dlp-credit-card-masking",
          name: "Credit Card Masking",
          description: "Mask PANs",
          category: "Data Protection",
        },
      ],
  };
}

describe("pack router", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  describe("list", () => {
    it("returns system packs with their templates", async () => {
      prismaMock.templatePack.findMany.mockResolvedValueOnce([makePack()] as never);

      const result = await caller.list();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Data Protection Pack");
      expect(result[0].isSystem).toBe(true);
      expect(result[0].templateCount).toBe(1);
      expect(result[0].templates[0].id).toBe("dlp-credit-card-masking");
      // Graph bodies (nodes/edges) are never exposed by the pack list.
      expect(result[0].templates[0]).not.toHaveProperty("nodes");
    });

    it("scopes the query to the default org + caller org (org-isolation)", async () => {
      prismaMock.templatePack.findMany.mockResolvedValueOnce([] as never);

      await caller.list();

      const args = prismaMock.templatePack.findMany.mock.calls[0][0] as {
        where: { organizationId: unknown };
      };
      expect(args.where.organizationId).toEqual({ in: ["default", "org-1"] });
    });

    it("flags an org-owned pack as non-system", async () => {
      prismaMock.templatePack.findMany.mockResolvedValueOnce([
        makePack({ id: "pack-team", organizationId: "org-1", featured: false }),
      ] as never);

      const result = await caller.list();

      expect(result[0].isSystem).toBe(false);
    });
  });

  describe("get", () => {
    it("returns a system pack (default org) with its templates", async () => {
      prismaMock.templatePack.findUnique.mockResolvedValueOnce(makePack() as never);

      const result = await caller.get({ id: "pack-data-protection" });

      expect(result.id).toBe("pack-data-protection");
      expect(result.isSystem).toBe(true);
      expect(result.templateCount).toBe(1);
    });

    it("returns a pack owned by the caller's own org", async () => {
      prismaMock.templatePack.findUnique.mockResolvedValueOnce(
        makePack({ id: "pack-team", organizationId: "org-1" }) as never,
      );

      const result = await caller.get({ id: "pack-team" });

      expect(result.id).toBe("pack-team");
      expect(result.isSystem).toBe(false);
    });

    it("rejects a pack from another org with NOT_FOUND", async () => {
      prismaMock.templatePack.findUnique.mockResolvedValueOnce(
        makePack({ id: "pack-foreign", organizationId: "org-2" }) as never,
      );

      await expect(caller.get({ id: "pack-foreign" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("rejects a missing pack with NOT_FOUND", async () => {
      prismaMock.templatePack.findUnique.mockResolvedValueOnce(null as never);

      await expect(caller.get({ id: "does-not-exist" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });
});
