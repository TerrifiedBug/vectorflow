// src/server/services/__tests__/pack-seed.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── Module mocks ───────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => {
  const __pm = mockDeep<PrismaClient>();
  return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
});

// ─── Import the mocked modules + SUT ───────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { seedCuratedPacks } from "../pack-seed";
import { ALL_DLP_TEMPLATES } from "../dlp-templates";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const GETTING_STARTED_IDS = ["dlp-email-redaction", "dlp-json-field-removal"];
const ALL_DLP_IDS = ALL_DLP_TEMPLATES.map((t) => t.id);
const DATA_PROTECTION_IDS = ALL_DLP_IDS.filter((id) => !GETTING_STARTED_IDS.includes(id));

beforeEach(() => {
  mockReset(prismaMock);
  prismaMock.templatePack.upsert.mockResolvedValue({} as never);
  prismaMock.template.updateMany.mockResolvedValue({ count: 0 } as never);
});

describe("seedCuratedPacks", () => {
  it("upserts exactly the two curated system packs", async () => {
    await seedCuratedPacks();

    expect(prismaMock.templatePack.upsert).toHaveBeenCalledTimes(2);
  });

  it("upserts on a stable id (idempotent — create and where ids match)", async () => {
    await seedCuratedPacks();

    for (const call of prismaMock.templatePack.upsert.mock.calls) {
      const args = call[0];
      expect(args.where.id).toBe(args.create.id);
    }
    const ids = prismaMock.templatePack.upsert.mock.calls.map((c) => c[0].where.id);
    expect(ids).toEqual(["pack-getting-started", "pack-data-protection"]);
  });

  it("seeds packs as SYSTEM packs in the default org", async () => {
    await seedCuratedPacks();

    for (const call of prismaMock.templatePack.upsert.mock.calls) {
      const args = call[0];
      expect(args.create.organizationId).toBe("default");
    }
  });

  it("re-applies the same name/description on update (idempotent upsert body)", async () => {
    await seedCuratedPacks();

    for (const call of prismaMock.templatePack.upsert.mock.calls) {
      const args = call[0];
      expect(args.update.name).toBe(args.create.name);
      expect(args.update.description).toBe(args.create.description);
    }
  });

  it("links member templates to their pack (sets packId + featured)", async () => {
    await seedCuratedPacks();

    expect(prismaMock.template.updateMany).toHaveBeenCalledTimes(2);

    const byPack = new Map<string, { ids: string[]; teamId: unknown; featured: unknown }>();
    for (const call of prismaMock.template.updateMany.mock.calls) {
      const args = call[0] as {
        where: { id: { in: string[] }; teamId: unknown };
        data: { packId: string; featured: unknown };
      };
      byPack.set(args.data.packId as string, {
        ids: (args.where.id as { in: string[] }).in,
        teamId: args.where.teamId,
        featured: args.data.featured,
      });
    }

    const gettingStarted = byPack.get("pack-getting-started");
    const dataProtection = byPack.get("pack-data-protection");
    expect(gettingStarted).toBeDefined();
    expect(dataProtection).toBeDefined();
    expect(gettingStarted!.featured).toBe(true);
    expect(dataProtection!.featured).toBe(true);
    expect([...gettingStarted!.ids].sort()).toEqual([...GETTING_STARTED_IDS].sort());
    expect([...dataProtection!.ids].sort()).toEqual([...DATA_PROTECTION_IDS].sort());
  });

  it("only links SYSTEM templates (teamId: null) so a tenant row can't be captured", async () => {
    await seedCuratedPacks();

    for (const call of prismaMock.template.updateMany.mock.calls) {
      const args = call[0] as { where: { teamId: unknown } };
      expect(args.where.teamId).toBeNull();
    }
  });

  it("partitions DLP templates across packs with no overlap and full coverage", async () => {
    await seedCuratedPacks();

    const linked = prismaMock.template.updateMany.mock.calls.flatMap(
      (c) => ((c[0] as { where: { id: { in: string[] } } }).where.id).in,
    );
    // No template assigned to more than one pack (packId is a single FK).
    expect(new Set(linked).size).toBe(linked.length);
    // Every DLP template lands in exactly one pack.
    expect([...new Set(linked)].sort()).toEqual([...ALL_DLP_IDS].sort());
  });
});
