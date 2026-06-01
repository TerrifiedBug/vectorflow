/**
 * AI provider base-URL allowlist + per-org opt-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

import { prisma } from "@/lib/prisma";
import {
  AI_PROVIDER_ALLOWLIST,
  AiBaseUrlNotAllowedError,
  enforceAiBaseUrlPolicy,
  isAllowlistedAiHost,
} from "@/server/services/ai-base-url-allowlist";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
  // `enforceAiBaseUrlPolicy` short-circuits when
  // `VF_STRICT_OUTBOUND` is unset (OSS default). The policy tests
  // below describe strict-outbound behaviour, so flip the flag on for them.
  vi.stubEnv("VF_STRICT_OUTBOUND", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("AI_PROVIDER_ALLOWLIST", () => {
  it("contains exactly the two vendor hosts", () => {
    // Keep the list explicit. Expanding it is a security-review change.
    expect([...AI_PROVIDER_ALLOWLIST].sort()).toEqual([
      "api.anthropic.com",
      "api.openai.com",
    ]);
  });
});

describe("isAllowlistedAiHost", () => {
  it("accepts exact vendor hostnames", () => {
    expect(isAllowlistedAiHost("api.openai.com")).toBe(true);
    expect(isAllowlistedAiHost("api.anthropic.com")).toBe(true);
  });

  it("accepts subdomains of allowlisted hosts", () => {
    expect(isAllowlistedAiHost("eu.api.openai.com")).toBe(true);
    expect(isAllowlistedAiHost("alpha.beta.api.anthropic.com")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isAllowlistedAiHost("API.OpenAI.com")).toBe(true);
  });

  it("rejects look-alike domains", () => {
    expect(isAllowlistedAiHost("api.openai.com.attacker.example")).toBe(false);
    expect(isAllowlistedAiHost("openai.com")).toBe(false);
    expect(isAllowlistedAiHost("notopenai.com")).toBe(false);
  });

  it("rejects unrelated hosts", () => {
    expect(isAllowlistedAiHost("api.openai.example")).toBe(false);
    expect(isAllowlistedAiHost("localhost")).toBe(false);
    expect(isAllowlistedAiHost("ollama.local")).toBe(false);
  });
});

describe("enforceAiBaseUrlPolicy", () => {
  it("short-circuits when VF_STRICT_OUTBOUND is unset (OSS default)", async () => {
    vi.unstubAllEnvs();
    await expect(
      enforceAiBaseUrlPolicy({
        baseUrl: "http://localhost:11434/v1",
        organizationId: "org-1",
      }),
    ).resolves.toBeUndefined();
    expect(prismaMock.organizationSettings.findUnique).not.toHaveBeenCalled();
  });

  it("accepts an allowlisted host without consulting the DB", async () => {
    await expect(
      enforceAiBaseUrlPolicy({
        baseUrl: "https://api.openai.com/v1",
        organizationId: "org-1",
      }),
    ).resolves.toBeUndefined();
    expect(prismaMock.organizationSettings.findUnique).not.toHaveBeenCalled();
  });

  it("accepts an allowlisted subdomain (regional endpoint)", async () => {
    await expect(
      enforceAiBaseUrlPolicy({
        baseUrl: "https://eu.api.anthropic.com/v1",
        organizationId: "org-1",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a non-allowlisted host when the org has NOT opted in", async () => {
    prismaMock.organizationSettings.findUnique.mockResolvedValue({
      aiBaseUrlOptIn: false,
    } as never);

    await expect(
      enforceAiBaseUrlPolicy({
        baseUrl: "https://custom-ai.example.com/v1",
        organizationId: "org-1",
      }),
    ).rejects.toBeInstanceOf(AiBaseUrlNotAllowedError);
  });

  it("accepts a non-allowlisted host when the org HAS opted in", async () => {
    prismaMock.organizationSettings.findUnique.mockResolvedValue({
      aiBaseUrlOptIn: true,
    } as never);

    await expect(
      enforceAiBaseUrlPolicy({
        baseUrl: "https://custom-ai.example.com/v1",
        organizationId: "org-1",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a non-allowlisted host when OrganizationSettings is missing", async () => {
    // No row → undefined → treat as "did not opt in".
    prismaMock.organizationSettings.findUnique.mockResolvedValue(null);

    await expect(
      enforceAiBaseUrlPolicy({
        baseUrl: "https://custom-ai.example.com/v1",
        organizationId: "org-new",
      }),
    ).rejects.toBeInstanceOf(AiBaseUrlNotAllowedError);
  });

  it("rejects non-http(s) schemes regardless of opt-in", async () => {
    await expect(
      enforceAiBaseUrlPolicy({
        baseUrl: "file:///etc/passwd",
        organizationId: "org-1",
      }),
    ).rejects.toThrow(/http or https/);
  });

  it("rejects malformed URLs regardless of opt-in", async () => {
    await expect(
      enforceAiBaseUrlPolicy({
        baseUrl: "not-a-url",
        organizationId: "org-1",
      }),
    ).rejects.toThrow(/Invalid AI base URL/);
  });

  it("AiBaseUrlNotAllowedError carries the host and org for audit", async () => {
    prismaMock.organizationSettings.findUnique.mockResolvedValue({
      aiBaseUrlOptIn: false,
    } as never);

    try {
      await enforceAiBaseUrlPolicy({
        baseUrl: "https://custom-ai.example.com/v1",
        organizationId: "org-42",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AiBaseUrlNotAllowedError);
      const e = err as AiBaseUrlNotAllowedError;
      expect(e.host).toBe("custom-ai.example.com");
      expect(e.organizationId).toBe("org-42");
      expect(e._tag).toBe("AiBaseUrlNotAllowedError");
    }
  });
});
