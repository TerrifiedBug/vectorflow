import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/lib/logger", () => ({
  debugLog: vi.fn(),
}));

vi.mock("@/server/services/git-sync", () => ({
  gitSyncCommitPipeline: vi.fn(),
  gitSyncDeletePipeline: vi.fn(),
  toFilenameSlug: vi.fn((name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-")),
}));

vi.mock("@/server/services/event-alerts", () => ({
  fireEventAlert: vi.fn(),
}));

vi.mock("@/server/services/sse-broadcast", () => ({
  broadcastSSE: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { gitSyncCommitPipeline, gitSyncDeletePipeline } from "@/server/services/git-sync";
import { fireEventAlert } from "@/server/services/event-alerts";
import { GitSyncRetryService, getNextRetryAt, createGitSyncJob } from "../git-sync-retry";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const commitMock = vi.mocked(gitSyncCommitPipeline);
const deleteMock = vi.mocked(gitSyncDeletePipeline);
const fireAlertMock = vi.mocked(fireEventAlert);

describe("getNextRetryAt", () => {
  it("returns 30s delay for attempt 0", () => {
    const result = getNextRetryAt(0);
    expect(result).not.toBeNull();
    const diff = result!.getTime() - Date.now();
    expect(diff).toBeGreaterThan(28_000);
    expect(diff).toBeLessThan(32_000);
  });

  it("returns 2m delay for attempt 1", () => {
    const result = getNextRetryAt(1);
    expect(result).not.toBeNull();
    const diff = result!.getTime() - Date.now();
    expect(diff).toBeGreaterThan(118_000);
    expect(diff).toBeLessThan(122_000);
  });

  it("returns 10m delay for attempt 2", () => {
    const result = getNextRetryAt(2);
    expect(result).not.toBeNull();
    const diff = result!.getTime() - Date.now();
    expect(diff).toBeGreaterThan(598_000);
    expect(diff).toBeLessThan(602_000);
  });

  it("returns null for attempt 3 (exceeded)", () => {
    expect(getNextRetryAt(3)).toBeNull();
  });
});

describe("GitSyncRetryService", () => {
  let service: GitSyncRetryService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GitSyncRetryService();
  });

  it("does nothing when no due jobs exist", async () => {
    prismaMock.gitSyncJob.findMany.mockResolvedValue([]);
    await service.processRetries();
    expect(commitMock).not.toHaveBeenCalled();
  });

  it("retries a commit job and marks it completed on success", async () => {
    const job = {
      id: "job-1",
      environmentId: "env-1",
      pipelineId: "pipe-1",
      action: "commit",
      configYaml: "sources:\n  in:\n    type: demo_logs",
      commitMessage: "Deploy pipeline",
      authorName: "Danny",
      authorEmail: "danny@test.com",
      attempts: 1,
      maxAttempts: 3,
      lastError: "network timeout",
      status: "pending",
      nextRetryAt: new Date(),
      createdAt: new Date(),
      completedAt: null,
      environment: {
        id: "env-1",
        name: "production",
        gitRepoUrl: "https://github.com/acme/configs",
        gitBranch: "main",
        gitToken: "encrypted-token",
      },
      pipeline: { id: "pipe-1", name: "my-pipeline", gitPath: null },
    };

    prismaMock.gitSyncJob.findMany.mockResolvedValue([job] as never);
    prismaMock.gitSyncJob.update.mockResolvedValue(job as never);
    commitMock.mockResolvedValue({ success: true, commitSha: "abc123" });

    await service.processRetries();

    expect(commitMock).toHaveBeenCalledWith(
      {
        repoUrl: "https://github.com/acme/configs",
        branch: "main",
        encryptedToken: "encrypted-token",
      },
      "production",
      "my-pipeline",
      "sources:\n  in:\n    type: demo_logs",
      { name: "Danny", email: "danny@test.com" },
      "Deploy pipeline",
      undefined,
    );

    // Should mark as completed
    expect(prismaMock.gitSyncJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: expect.objectContaining({ status: "completed" }),
      }),
    );
  });

  it("marks job as failed after max attempts and fires alert", async () => {
    const job = {
      id: "job-2",
      environmentId: "env-1",
      pipelineId: "pipe-1",
      action: "commit",
      configYaml: "test: yaml",
      commitMessage: "Deploy",
      authorName: null,
      authorEmail: null,
      attempts: 2, // Will become 3 (max)
      maxAttempts: 3,
      lastError: "auth failed",
      status: "pending",
      nextRetryAt: new Date(),
      createdAt: new Date(),
      completedAt: null,
      environment: {
        id: "env-1",
        name: "staging",
        gitRepoUrl: "https://github.com/acme/configs",
        gitBranch: "main",
        gitToken: "enc-token",
      },
      pipeline: { id: "pipe-1", name: "pipeline-a", gitPath: null },
    };

    prismaMock.gitSyncJob.findMany.mockResolvedValue([job] as never);
    prismaMock.gitSyncJob.update.mockResolvedValue(job as never);
    commitMock.mockResolvedValue({ success: false, error: "auth failed again" });
    fireAlertMock.mockResolvedValue(undefined as never);

    await service.processRetries();

    // Should mark as failed
    expect(prismaMock.gitSyncJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-2" },
        data: expect.objectContaining({ status: "failed" }),
      }),
    );

    // Should fire alert
    expect(fireAlertMock).toHaveBeenCalledWith(
      "git_sync_failed",
      "env-1",
      expect.objectContaining({ message: expect.stringContaining("auth failed") }),
    );
  });
});

describe("createGitSyncJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a job with correct defaults", async () => {
    prismaMock.gitSyncJob.create.mockResolvedValue({} as never);

    await createGitSyncJob({
      environmentId: "env-1",
      pipelineId: "pipe-1",
      action: "commit",
      configYaml: "test: yaml",
      commitMessage: "Deploy",
      error: "timeout",
    });

    expect(prismaMock.gitSyncJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        environmentId: "env-1",
        pipelineId: "pipe-1",
        action: "commit",
        configYaml: "test: yaml",
        commitMessage: "Deploy",
        attempts: 1,
        lastError: "timeout",
        nextRetryAt: expect.any(Date),
      }),
    });
  });
});
