// src/server/services/__tests__/dlp-template-seed.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── Module mocks ───────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

// ─── Import the mocked modules + SUT ───────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { seedDlpTemplates } from "../dlp-template-seed";
import { ALL_DLP_TEMPLATES } from "../dlp-templates";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
});

describe("seedDlpTemplates", () => {
  it("upserts all 8 DLP templates", async () => {
    prismaMock.template.upsert.mockResolvedValue({} as never);

    await seedDlpTemplates();

    expect(prismaMock.template.upsert).toHaveBeenCalledTimes(8);
  });

  it("uses the DLP template id as the Prisma record id", async () => {
    prismaMock.template.upsert.mockResolvedValue({} as never);

    await seedDlpTemplates();

    const firstCallArgs = prismaMock.template.upsert.mock.calls[0][0];
    expect(firstCallArgs.where.id).toBe(ALL_DLP_TEMPLATES[0].id);
  });

  it("sets teamId to null for system-level templates", async () => {
    prismaMock.template.upsert.mockResolvedValue({} as never);

    await seedDlpTemplates();

    for (const call of prismaMock.template.upsert.mock.calls) {
      const args = call[0];
      expect(args.create.teamId).toBeNull();
    }
  });

  it("sets category to 'Data Protection' for all templates", async () => {
    prismaMock.template.upsert.mockResolvedValue({} as never);

    await seedDlpTemplates();

    for (const call of prismaMock.template.upsert.mock.calls) {
      const args = call[0];
      expect(args.create.category).toBe("Data Protection");
    }
  });

  it("stores complianceTags in the nodes JSON metadata", async () => {
    prismaMock.template.upsert.mockResolvedValue({} as never);

    await seedDlpTemplates();

    const firstCallArgs = prismaMock.template.upsert.mock.calls[0][0];
    const nodes = firstCallArgs.create.nodes as unknown[];
    expect(Array.isArray(nodes)).toBe(true);
    expect(nodes.length).toBe(1);
    const node = nodes[0] as Record<string, unknown>;
    expect(node.kind).toBe("transform");
    expect(node.componentType).toBe("remap");
  });

  it("each template node contains the VRL source in config", async () => {
    prismaMock.template.upsert.mockResolvedValue({} as never);

    await seedDlpTemplates();

    for (const call of prismaMock.template.upsert.mock.calls) {
      const args = call[0];
      const nodes = args.create.nodes as Array<{ config: { source: string } }>;
      expect(nodes[0].config.source).toBeTruthy();
      expect(nodes[0].config.source.length).toBeGreaterThan(10);
    }
  });
});
