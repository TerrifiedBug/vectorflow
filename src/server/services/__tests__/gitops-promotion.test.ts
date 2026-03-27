import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(),
}));

vi.mock("@/server/services/crypto", () => ({
  decrypt: vi.fn((encrypted: string) => `decrypted-${encrypted}`),
}));

vi.mock("@/server/services/git-sync", () => ({
  toFilenameSlug: vi.fn((name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { Octokit } from "@octokit/rest";
import { createPromotionPR, parseGitHubOwnerRepo } from "@/server/services/gitops-promotion";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeOctokitMock(overrides?: Record<string, unknown>) {
  const getRef = vi.fn().mockResolvedValue({
    data: { object: { sha: "base-sha-abc123" } },
  });
  const createRef = vi.fn().mockResolvedValue({});
  const getContent = vi.fn().mockRejectedValue(new Error("Not Found")); // Default: file does not exist
  const createOrUpdateFileContents = vi.fn().mockResolvedValue({});
  const create = vi.fn().mockResolvedValue({
    data: { number: 42, html_url: "https://github.com/owner/repo/pull/42" },
  });

  return {
    rest: {
      git: { getRef, createRef },
      repos: { getContent, createOrUpdateFileContents },
      pulls: { create },
    },
    ...overrides,
  };
}

// ─── Tests: parseGitHubOwnerRepo ─────────────────────────────────────────────

describe("parseGitHubOwnerRepo", () => {
  it("parses HTTPS URL without .git", () => {
    const result = parseGitHubOwnerRepo("https://github.com/myorg/myrepo");
    expect(result).toEqual({ owner: "myorg", repo: "myrepo" });
  });

  it("parses HTTPS URL with .git", () => {
    const result = parseGitHubOwnerRepo("https://github.com/myorg/myrepo.git");
    expect(result).toEqual({ owner: "myorg", repo: "myrepo" });
  });

  it("parses SSH URL", () => {
    const result = parseGitHubOwnerRepo("git@github.com:myorg/myrepo.git");
    expect(result).toEqual({ owner: "myorg", repo: "myrepo" });
  });

  it("parses SSH URL without .git", () => {
    const result = parseGitHubOwnerRepo("git@github.com:myorg/myrepo");
    expect(result).toEqual({ owner: "myorg", repo: "myrepo" });
  });

  it("throws for unrecognized URL format", () => {
    expect(() => parseGitHubOwnerRepo("https://gitlab.com/myorg/myrepo")).toThrow(
      "Cannot parse GitHub owner/repo",
    );
  });
});

// ─── Tests: createPromotionPR ─────────────────────────────────────────────────

describe("createPromotionPR", () => {
  let octokitMock: ReturnType<typeof makeOctokitMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    octokitMock = makeOctokitMock();
    // Must use a function (not arrow) so `new` works correctly in Vitest
    vi.mocked(Octokit).mockImplementation(function () {
      return octokitMock as never;
    });
  });

  const baseOpts = {
    encryptedToken: "enc-token",
    repoUrl: "https://github.com/myorg/myrepo",
    baseBranch: "main",
    requestId: "req1234567890",
    pipelineName: "My Pipeline",
    sourceEnvironmentName: "Development",
    targetEnvironmentName: "Production",
    configYaml: "sources:\n  my_source:\n    type: stdin\n",
  };

  it("decrypts token and instantiates Octokit with it", async () => {
    await createPromotionPR(baseOpts);
    expect(Octokit).toHaveBeenCalledWith({ auth: "decrypted-enc-token" });
  });

  it("gets base branch SHA before creating PR branch", async () => {
    await createPromotionPR(baseOpts);
    expect(octokitMock.rest.git.getRef).toHaveBeenCalledWith({
      owner: "myorg",
      repo: "myrepo",
      ref: "heads/main",
    });
  });

  it("creates a PR branch with unique name including requestId prefix", async () => {
    await createPromotionPR(baseOpts);
    expect(octokitMock.rest.git.createRef).toHaveBeenCalledWith({
      owner: "myorg",
      repo: "myrepo",
      ref: "refs/heads/vf-promote/production-my-pipeline-req12345",
      sha: "base-sha-abc123",
    });
  });

  it("commits YAML file at envSlug/pipelineSlug.yaml on the PR branch", async () => {
    await createPromotionPR(baseOpts);
    expect(octokitMock.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "myorg",
        repo: "myrepo",
        path: "production/my-pipeline.yaml",
        branch: "vf-promote/production-my-pipeline-req12345",
        content: Buffer.from(baseOpts.configYaml).toString("base64"),
      }),
    );
  });

  it("opens PR with promotion request ID embedded in body", async () => {
    await createPromotionPR(baseOpts);
    const createCall = octokitMock.rest.pulls.create.mock.calls[0][0];
    expect(createCall.body).toContain("<!-- vf-promotion-request-id: req1234567890 -->");
    expect(createCall.title).toContain("My Pipeline");
    expect(createCall.title).toContain("Production");
    expect(createCall.head).toBe("vf-promote/production-my-pipeline-req12345");
    expect(createCall.base).toBe("main");
  });

  it("returns prNumber, prUrl, and prBranch from GitHub response", async () => {
    const result = await createPromotionPR(baseOpts);
    expect(result.prNumber).toBe(42);
    expect(result.prUrl).toBe("https://github.com/owner/repo/pull/42");
    expect(result.prBranch).toBe("vf-promote/production-my-pipeline-req12345");
  });

  it("includes existing file SHA when file already exists on branch", async () => {
    octokitMock.rest.repos.getContent.mockResolvedValue({
      data: { sha: "existing-file-sha", type: "file", name: "my-pipeline.yaml" },
    } as never);

    await createPromotionPR(baseOpts);

    expect(octokitMock.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ sha: "existing-file-sha" }),
    );
  });

  it("does not include sha when file does not exist yet (new file creation)", async () => {
    // Default mock: getContent throws "Not Found"
    await createPromotionPR(baseOpts);

    const updateCall = octokitMock.rest.repos.createOrUpdateFileContents.mock.calls[0][0];
    expect(updateCall.sha).toBeUndefined();
  });

  it("parses SSH URL format correctly", async () => {
    await createPromotionPR({
      ...baseOpts,
      repoUrl: "git@github.com:myorg/myrepo.git",
    });
    expect(octokitMock.rest.git.getRef).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "myorg", repo: "myrepo" }),
    );
  });
});
