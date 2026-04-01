import { prisma } from "@/lib/prisma";
import { debugLog, infoLog, errorLog } from "@/lib/logger";
import { gitSyncCommitPipeline, gitSyncDeletePipeline } from "@/server/services/git-sync";
import { fireEventAlert } from "@/server/services/event-alerts";
import { broadcastSSE } from "@/server/services/sse-broadcast";

// --- Constants ---

const POLL_INTERVAL_MS = 30_000;
const BATCH_SIZE = 10;

/** Retry schedule: 30s, 2m, 10m */
const RETRY_DELAYS_MS = [30_000, 120_000, 600_000];

// --- Helpers ---

export function getNextRetryAt(attemptNumber: number): Date | null {
  const delayMs = RETRY_DELAYS_MS[attemptNumber];
  if (!delayMs) return null;
  return new Date(Date.now() + delayMs);
}

// --- Service ---

export class GitSyncRetryService {
  private timer: ReturnType<typeof setInterval> | null = null;

  init(): void {
    infoLog("git-sync-retry", "Initializing git sync retry service");
    this.start();
  }

  start(): void {
    this.timer = setInterval(
      this.processRetries.bind(this),
      POLL_INTERVAL_MS,
    );
    this.timer.unref();
    infoLog("git-sync-retry", `Poll loop started (every ${POLL_INTERVAL_MS / 1000}s)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      infoLog("git-sync-retry", "Poll loop stopped");
    }
  }

  async processRetries(): Promise<void> {
    let dueJobs;
    try {
      dueJobs = await prisma.gitSyncJob.findMany({
        where: {
          status: "pending",
          nextRetryAt: { lte: new Date() },
        },
        include: {
          environment: {
            select: {
              id: true,
              name: true,
              gitRepoUrl: true,
              gitBranch: true,
              gitToken: true,
            },
          },
          pipeline: {
            select: { id: true, name: true, gitPath: true },
          },
        },
        orderBy: { nextRetryAt: "asc" },
        take: BATCH_SIZE,
      });
    } catch (err) {
      errorLog("git-sync-retry", "Error querying due jobs", err);
      return;
    }

    if (dueJobs.length === 0) return;

    debugLog("gitsync", `Found ${dueJobs.length} due retry job(s)`);

    for (const job of dueJobs) {
      try {
        // Claim the job by incrementing attempts
        const newAttempts = job.attempts + 1;
        await prisma.gitSyncJob.update({
          where: { id: job.id },
          data: {
            attempts: newAttempts,
            nextRetryAt: null,
          },
        });

        const env = job.environment;
        if (!env.gitRepoUrl || !env.gitToken) {
          await this.markFailed(job.id, job.environmentId, "No git repo URL or token configured");
          continue;
        }

        const config = {
          repoUrl: env.gitRepoUrl,
          branch: env.gitBranch ?? "main",
          encryptedToken: env.gitToken,
        };

        // Use gitPath if available, otherwise derive from pipeline name
        const pipelineNameForSync = job.pipeline.name;

        let result;
        if (job.action === "commit") {
          if (!job.configYaml) {
            await this.markFailed(job.id, job.environmentId, "No configYaml for commit action");
            continue;
          }
          result = await gitSyncCommitPipeline(
            config,
            env.name,
            pipelineNameForSync,
            job.configYaml,
            { name: job.authorName ?? "VectorFlow", email: job.authorEmail ?? "noreply@vectorflow" },
            job.commitMessage ?? `Retry: sync pipeline ${pipelineNameForSync}`,
            job.pipeline.gitPath ?? undefined,
          );
        } else if (job.action === "delete") {
          result = await gitSyncDeletePipeline(
            config,
            env.name,
            pipelineNameForSync,
            { name: job.authorName ?? "VectorFlow", email: job.authorEmail ?? "noreply@vectorflow" },
            job.pipeline.gitPath ?? undefined,
          );
        } else {
          await this.markFailed(job.id, job.environmentId, `Unknown action: ${job.action}`);
          continue;
        }

        if (result.success) {
          await prisma.gitSyncJob.update({
            where: { id: job.id },
            data: { status: "completed", completedAt: new Date() },
          });
          debugLog("gitsync", `Job ${job.id} succeeded (attempt ${newAttempts})`);

          broadcastSSE({
            type: "git_sync_status",
            environmentId: job.environmentId,
            status: "completed",
            jobId: job.id,
          }, job.environmentId);
        } else {
          // Check if max attempts reached
          if (newAttempts >= job.maxAttempts) {
            await this.markFailed(job.id, job.environmentId, result.error ?? "Unknown error");
          } else {
            // Schedule next retry
            const nextRetryAt = getNextRetryAt(newAttempts);
            await prisma.gitSyncJob.update({
              where: { id: job.id },
              data: {
                lastError: result.error ?? "Unknown error",
                nextRetryAt,
              },
            });
            debugLog(
              "gitsync",
              `Job ${job.id} failed (attempt ${newAttempts}/${job.maxAttempts}), next retry at ${nextRetryAt?.toISOString()}`,
            );
          }
        }
      } catch (err) {
        errorLog("git-sync-retry", `Error processing job ${job.id}`, err);
      }
    }
  }

  private async markFailed(jobId: string, environmentId: string, error: string): Promise<void> {
    await prisma.gitSyncJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        lastError: error,
        completedAt: new Date(),
      },
    });

    // Fire git_sync_failed alert
    try {
      await fireEventAlert("git_sync_failed", environmentId, {
        message: `Git sync failed after max retries: ${error}`,
      });
    } catch {
      // Alert failure must not mask the sync failure
    }

    broadcastSSE({
      type: "git_sync_status",
      environmentId,
      status: "failed",
      jobId,
    }, environmentId);
  }
}

// --- Singleton ---

export const gitSyncRetryService = new GitSyncRetryService();

export function initGitSyncRetryService(): void {
  gitSyncRetryService.init();
}

// --- Job Creation Helper ---

/**
 * Create a GitSyncJob for a failed git sync operation.
 * The job will be picked up by the retry service.
 */
export async function createGitSyncJob(opts: {
  environmentId: string;
  pipelineId: string;
  action: "commit" | "delete";
  configYaml?: string;
  commitMessage?: string;
  authorName?: string;
  authorEmail?: string;
  error: string;
}): Promise<void> {
  const nextRetryAt = getNextRetryAt(0);
  await prisma.gitSyncJob.create({
    data: {
      environmentId: opts.environmentId,
      pipelineId: opts.pipelineId,
      action: opts.action,
      configYaml: opts.configYaml ?? null,
      commitMessage: opts.commitMessage ?? null,
      authorName: opts.authorName ?? null,
      authorEmail: opts.authorEmail ?? null,
      attempts: 1, // First attempt already happened in deploy-agent
      lastError: opts.error,
      nextRetryAt,
    },
  });
}
