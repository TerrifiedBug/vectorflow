import { describe, it, expect, vi } from "vitest";

// Mock dependencies
vi.mock("@/lib/prisma", () => ({
  prisma: {
    environment: { findMany: vi.fn() },
    pipeline: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    pipelineNode: { create: vi.fn(), deleteMany: vi.fn() },
    pipelineEdge: { create: vi.fn(), deleteMany: vi.fn() },
    promotionRequest: { updateMany: vi.fn(), findUnique: vi.fn() },
    deployRequest: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/server/services/crypto", () => ({
  decrypt: vi.fn((val: string) => val),
  encrypt: vi.fn((val: string) => val),
}));

vi.mock("@/server/services/config-crypto", () => ({
  encryptNodeConfig: vi.fn((_type: string, config: unknown) => config),
}));

vi.mock("@/server/services/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/config-generator", () => ({
  importVectorConfig: vi.fn(() => ({
    nodes: [],
    edges: [],
    globalConfig: null,
  })),
  generateVectorYaml: vi.fn(() => "test: yaml"),
}));

vi.mock("@/server/services/promotion-service", () => ({
  executePromotion: vi.fn(),
}));

import { detectProvider } from "@/server/services/git-providers";

describe("detectProvider", () => {
  it("detects github from URL", () => {
    expect(detectProvider("https://github.com/acme/repo.git")).toBe("github");
  });

  it("detects gitlab from URL", () => {
    expect(detectProvider("https://gitlab.com/acme/repo")).toBe("gitlab");
  });

  it("detects bitbucket from URL", () => {
    expect(detectProvider("https://bitbucket.org/acme/repo")).toBe("bitbucket");
  });

  it("detects github from SSH URL", () => {
    expect(detectProvider("git@github.com:acme/repo.git")).toBe("github");
  });

  it("returns null for unknown domain", () => {
    expect(detectProvider("https://custom-git.internal/acme/repo")).toBeNull();
  });
});

describe("getProvider", () => {
  it("returns provider from explicit gitProvider field", async () => {
    const { getProvider } = await import("@/server/services/git-providers");
    const provider = getProvider({ gitProvider: "gitlab", gitRepoUrl: "https://github.com/foo/bar" });
    expect(provider?.name).toBe("gitlab");
  });

  it("auto-detects provider from repoUrl when gitProvider is null", async () => {
    const { getProvider } = await import("@/server/services/git-providers");
    const provider = getProvider({ gitProvider: null, gitRepoUrl: "https://github.com/foo/bar" });
    expect(provider?.name).toBe("github");
  });

  it("returns null when no provider can be resolved", async () => {
    const { getProvider } = await import("@/server/services/git-providers");
    const provider = getProvider({ gitProvider: null, gitRepoUrl: null });
    expect(provider).toBeNull();
  });
});
