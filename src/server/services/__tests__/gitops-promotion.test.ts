import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/services/crypto", () => ({
  ENCRYPTION_DOMAINS: { GENERIC: "generic" } as const,
  decrypt: vi.fn((val: string) => `decrypted-${val}`),
  encrypt: vi.fn((val: string) => `enc:${val}`),
  decryptForOrg: vi.fn(async (val: string) => `v3-decrypted-${val}`),
  encryptForOrg: vi.fn(async (val: string) => `v3:${val}`),
}));

const mockProvider = {
  name: "github" as const,
  verifyWebhookSignature: vi.fn(),
  parseWebhookEvent: vi.fn(),
  parseRepoUrl: vi.fn(() => ({ owner: "acme", repo: "configs" })),
  fetchFileContent: vi.fn(),
  createBranch: vi.fn(),
  commitFile: vi.fn().mockResolvedValue("sha123"),
  createPullRequest: vi.fn().mockResolvedValue({ url: "https://github.com/acme/configs/pull/1", number: 1 }),
};

vi.mock("@/server/services/git-providers", () => ({
  getProvider: vi.fn(() => mockProvider),
}));

import { createPromotionPR } from "../gitops-promotion";

describe("createPromotionPR", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates branch, commits file, and opens PR", async () => {
    const result = await createPromotionPR({
      encryptedToken: "enc-token",
      repoUrl: "https://github.com/acme/configs",
      baseBranch: "main",
      requestId: "req12345678",
      pipelineName: "My Pipeline",
      sourceEnvironmentName: "Staging",
      targetEnvironmentName: "Production",
      configYaml: "sources:\n  in:\n    type: demo_logs",
      orgId: "default",
      environmentId: "env-1",
      dataKeyCiphertext: null,
    });

    expect(mockProvider.createBranch).toHaveBeenCalledWith(
      "https://github.com/acme/configs",
      "decrypted-enc-token",
      "main",
      "vf-promote/production-my-pipeline-req12345",
    );

    expect(mockProvider.commitFile).toHaveBeenCalledWith(
      "https://github.com/acme/configs",
      "decrypted-enc-token",
      "vf-promote/production-my-pipeline-req12345",
      "production/my-pipeline.yaml",
      expect.any(String),
      expect.stringContaining("My Pipeline"),
    );

    expect(mockProvider.createPullRequest).toHaveBeenCalled();
    expect(result.prUrl).toBe("https://github.com/acme/configs/pull/1");
    expect(result.prNumber).toBe(1);
  });

  it("uses gitPath when provided instead of deriving from slugs", async () => {
    await createPromotionPR({
      encryptedToken: "enc-token",
      repoUrl: "https://github.com/acme/configs",
      baseBranch: "main",
      requestId: "req12345678",
      pipelineName: "My Pipeline",
      sourceEnvironmentName: "Staging",
      targetEnvironmentName: "Production",
      configYaml: "test: yaml",
      gitPath: "custom/path/pipeline.yaml",
      orgId: "default",
      environmentId: "env-1",
      dataKeyCiphertext: null,
    });

    expect(mockProvider.commitFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      "custom/path/pipeline.yaml",
      expect.any(String),
      expect.any(String),
    );
  });
});
