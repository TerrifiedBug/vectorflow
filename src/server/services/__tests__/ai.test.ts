import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

// `crypto.ts` is mocked with shape-stable stubs so the v2 / v3 wrapper
// branches resolve deterministically. The wrapper itself stays real so
// that branch routing is what's exercised, not the mock.
vi.mock("@/server/services/crypto", () => ({
  ENCRYPTION_DOMAINS: { GENERIC: "generic" } as const,
  encrypt: vi.fn((val: string) => `v2:${val}`),
  decrypt: vi.fn((val: string) => val.replace(/^v2:/, "")),
  encryptForOrg: vi.fn(async (val: string) => `v3:${val}`),
  decryptForOrg: vi.fn(async (val: string) => val.replace(/^v3:/, "")),
}));

// The wrapper is not mocked here — we want it to execute its branch
// logic against the stubbed `crypto.ts` module.
vi.mock("@/server/services/crypto-v3-callsite", async () => {
  return await vi.importActual<typeof import("@/server/services/crypto-v3-callsite")>(
    "@/server/services/crypto-v3-callsite",
  );
});

vi.mock("@/lib/ai/rate-limiter", () => ({
  checkRateLimit: vi.fn(),
}));
vi.mock("@/lib/is-demo-mode", () => ({ isDemoMode: () => false }));
vi.mock("@/server/services/url-validation", () => ({
  validateOutboundUrl: vi.fn(),
}));
vi.mock("@/server/services/ai-base-url-allowlist", () => ({
  enforceAiBaseUrlPolicy: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { getTeamAiConfig } from "@/server/services/ai";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
  vi.clearAllMocks();
});

describe("getTeamAiConfig — v3-or-v2 envelope decrypt for aiApiKey (PR 9-A)", () => {
  it("decrypts a v2 (legacy 'enc:') ciphertext when the org has no dataKeyCiphertext", async () => {
    prismaMock.team.findUnique.mockResolvedValue({
      organizationId: "org_a",
      aiEnabled: true,
      aiProvider: "openai",
      aiBaseUrl: null,
      aiApiKey: "enc:v2:sk-stored",
      aiModel: "gpt-4o",
    } as never);
    prismaMock.organization.findUnique.mockResolvedValue({
      dataKeyCiphertext: null,
    } as never);

    const cfg = await getTeamAiConfig("team-1");

    expect(cfg.apiKey).toBe("sk-stored");
    expect(cfg.provider).toBe("openai");
  });

  it("decrypts a v3 ciphertext when the org has a dataKeyCiphertext", async () => {
    prismaMock.team.findUnique.mockResolvedValue({
      organizationId: "org_a",
      aiEnabled: true,
      aiProvider: "openai",
      aiBaseUrl: null,
      aiApiKey: "enc:v3:sk-stored-v3",
      aiModel: "gpt-4o",
    } as never);
    prismaMock.organization.findUnique.mockResolvedValue({
      dataKeyCiphertext: "wrapped-dek",
    } as never);

    const cfg = await getTeamAiConfig("team-1");

    expect(cfg.apiKey).toBe("sk-stored-v3");
  });

  it("still reads a v2 ciphertext on an org that later acquired a DEK (back-compat read)", async () => {
    // The Org row has a DEK but the Team.aiApiKey was written before
    // the backfill — it still carries the v2 ciphertext. The wrapper
    // MUST route by ciphertext prefix, not by org-row presence.
    prismaMock.team.findUnique.mockResolvedValue({
      organizationId: "org_a",
      aiEnabled: true,
      aiProvider: "openai",
      aiBaseUrl: null,
      aiApiKey: "enc:v2:sk-legacy",
      aiModel: "gpt-4o",
    } as never);
    prismaMock.organization.findUnique.mockResolvedValue({
      dataKeyCiphertext: "wrapped-dek",
    } as never);

    const cfg = await getTeamAiConfig("team-1");

    expect(cfg.apiKey).toBe("sk-legacy");
  });

  it("throws when the team has no aiApiKey configured", async () => {
    prismaMock.team.findUnique.mockResolvedValue({
      organizationId: "org_a",
      aiEnabled: true,
      aiProvider: "openai",
      aiBaseUrl: null,
      aiApiKey: null,
      aiModel: "gpt-4o",
    } as never);

    await expect(getTeamAiConfig("team-1")).rejects.toThrow(
      "AI API key is not configured",
    );
  });
});
