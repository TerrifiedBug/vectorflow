import { adminPrisma, prisma } from "@/lib/prisma";
import { runWithOrgContext } from "@/lib/org-context";
import { deployFromVersion } from "@/server/services/pipeline-version";
import { fireEventAlert } from "@/server/services/event-alerts";
import { broadcastSSE } from "@/server/services/sse-broadcast";
import { writeAuditLog } from "@/server/services/audit";
import { infoLog, errorLog } from "@/lib/logger";

// ─── Constants ──────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute aggregate error rate across all NodePipelineStatus rows for a pipeline.
 * Returns the percentage of errorsTotal / eventsIn, or null if no rows exist.
 * Returns 0 if totalIn is 0 (no events processed → no errors).
 */
export async function getAggregateErrorRate(
  pipelineId: string,
): Promise<number | null> {
  try {
    const rows = await prisma.nodePipelineStatus.findMany({
      where: { pipelineId },
      select: { eventsIn: true, errorsTotal: true },
    });

    if (rows.length === 0) return null;

    let totalIn = BigInt(0);
    let totalErrors = BigInt(0);

    for (const row of rows) {
      totalIn += BigInt(row.eventsIn);
      totalErrors += BigInt(row.errorsTotal);
    }

    if (totalIn === BigInt(0)) return 0;

    // Convert to percentage: (errors / totalIn) * 100
    return Number((totalErrors * BigInt(10000)) / totalIn) / 100;
  } catch (err) {
    errorLog("auto-rollback", `Error computing error rate for pipeline=${pipelineId}`, err);
    return null;
  }
}

/**
 * Get the most recent mean latency for a pipeline from PipelineMetric rows.
 * Returns the latency in ms, or null if no recent data is available.
 */
export async function getRecentMeanLatency(
  pipelineId: string,
): Promise<number | null> {
  try {
    const metric = await prisma.pipelineMetric.findFirst({
      where: { pipelineId, latencyMeanMs: { not: null } },
      orderBy: { timestamp: "desc" },
      select: { latencyMeanMs: true },
    });
    return metric?.latencyMeanMs ?? null;
  } catch (err) {
    errorLog("auto-rollback", `Error computing mean latency for pipeline=${pipelineId}`, err);
    return null;
  }
}

// ─── AutoRollbackService ────────────────────────────────────────────────────

export class AutoRollbackService {
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * True while a tick is currently executing. The per-org fan-out can
   * exceed POLL_INTERVAL_MS in fleets with many tenants; setInterval
   * does NOT skip overlapping callbacks, so without this guard two
   * ticks could run concurrently and double-rollback the same pipeline.
   */
  private tickInFlight = false;

  init(): void {
    infoLog("auto-rollback", "Initializing auto-rollback service");
    this.start();
  }

  start(): void {
    this.timer = setInterval(
      () => void this.tick(),
      POLL_INTERVAL_MS,
    );
    this.timer.unref();
    infoLog("auto-rollback", `Poll loop started (every ${POLL_INTERVAL_MS / 1000}s)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      infoLog("auto-rollback", "Poll loop stopped");
    }
  }

  /**
   * Single tick: iterate orgs and process each one's pipelines. The
   * `tickInFlight` guard prevents overlapping invocations when fan-out
   * exceeds POLL_INTERVAL_MS. A failure listing orgs returns early
   * (logged) so a transient DB error does not become an unhandled
   * rejection that ends the process.
   */
  private async tick(): Promise<void> {
    if (this.tickInFlight) {
      infoLog(
        "auto-rollback",
        "Previous tick still in flight; skipping this interval to avoid overlap",
      );
      return;
    }
    this.tickInFlight = true;
    try {
      let orgs: Array<{ id: string }>;
      try {
        orgs = await adminPrisma.organization.findMany({
          where: { suspendedAt: null, deletedAt: null },
          select: { id: true },
        });
      } catch (err) {
        errorLog(
          "auto-rollback",
          "Failed to list organizations for tick (skipping this cycle)",
          err,
        );
        return;
      }
      for (const org of orgs) {
        try {
          await runWithOrgContext(org.id, () =>
            this.checkPipelines({ organizationId: org.id }),
          );
        } catch (err) {
          errorLog(
            "auto-rollback",
            `org=${org.id} checkPipelines error (continuing)`,
            err,
          );
        }
      }
    } finally {
      this.tickInFlight = false;
    }
  }

  /**
   * Core poll loop body: finds pipelines with auto-rollback enabled that
   * were deployed within the monitoring window, checks their aggregate
   * error rate, and triggers rollback if the threshold is exceeded.
   *
   * When `opts.organizationId` is supplied the query is scoped to that
   * org — the per-org `tick()` uses this. Exported via the class so
   * tests can drive the body directly.
   */
  async checkPipelines(opts: { organizationId?: string } = {}): Promise<void> {
    let candidates;
    try {
      candidates = await prisma.pipeline.findMany({
        where: {
          autoRollbackEnabled: true,
          isDraft: false,
          deployedAt: { not: null },
          ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
        },
        select: {
          id: true,
          name: true,
          environmentId: true,
          autoRollbackThreshold: true,
          autoRollbackWindowMinutes: true,
          deployedAt: true,
        },
      });
    } catch (err) {
      errorLog("auto-rollback", "Error querying candidate pipelines", err);
      return;
    }

    // Filter candidates whose deployedAt is within the monitoring window
    const now = Date.now();
    const activeCandidates = candidates.filter((p) => {
      if (!p.deployedAt) return false;
      const windowMs = p.autoRollbackWindowMinutes * 60 * 1000;
      return now - p.deployedAt.getTime() < windowMs;
    });

    if (activeCandidates.length === 0) return;

    infoLog("auto-rollback", `Found ${activeCandidates.length} candidate pipeline(s)`);

    for (const pipeline of activeCandidates) {
      try {
        // Get the 2 most recent versions: latest = current, second = rollback target
        const versions = await prisma.pipelineVersion.findMany({
          where: { pipelineId: pipeline.id },
          orderBy: { version: "desc" },
          take: 2,
          select: { id: true, version: true, createdById: true },
        });

        if (versions.length < 2) {
          infoLog("auto-rollback", `Pipeline ${pipeline.id} (${pipeline.name}) has no previous version — skipping`);
          continue;
        }

        const [latestVersion, previousVersion] = versions;

        // Compute aggregate error rate
        const errorRate = await getAggregateErrorRate(pipeline.id);

        if (errorRate === null) {
          infoLog("auto-rollback", `Pipeline ${pipeline.id} (${pipeline.name}) has no status data — skipping`);
          continue;
        }

        if (errorRate <= pipeline.autoRollbackThreshold) {
          continue;
        }

        // Error rate exceeds threshold — trigger rollback
        infoLog("auto-rollback", `Pipeline ${pipeline.id} (${pipeline.name}) error rate ${errorRate.toFixed(2)}% exceeds threshold ${pipeline.autoRollbackThreshold}% — triggering rollback`);

        // Check for userId — need it for deployFromVersion
        if (!latestVersion!.createdById) {
          errorLog("auto-rollback", `Pipeline ${pipeline.id} (${pipeline.name}) latest version has no createdById — skipping rollback`);
          continue;
        }

        // Perform the rollback
        const rollbackResult = await deployFromVersion(
          pipeline.id,
          previousVersion!.id,
          latestVersion!.createdById,
          `Auto-rollback: error rate ${errorRate.toFixed(2)}% exceeded threshold ${pipeline.autoRollbackThreshold}%`,
        );

        // Audit log for auto-rollback
        writeAuditLog({
          userId: latestVersion!.createdById,
          action: "deploy.auto_rollback",
          entityType: "Pipeline",
          entityId: pipeline.id,
          metadata: {
            timestamp: new Date().toISOString(),
            errorRate: errorRate.toFixed(2),
            threshold: pipeline.autoRollbackThreshold,
            rolledBackFromVersion: latestVersion!.version,
            rolledBackToVersion: previousVersion!.version,
            pushedNodeIds: rollbackResult.pushedNodeIds,
          },
          environmentId: pipeline.environmentId,
        }).catch(() => {});

        // Disable auto-rollback to prevent loops
        await prisma.pipeline.update({
          where: { id: pipeline.id },
          data: { autoRollbackEnabled: false },
        });

        // If there's an active staged rollout for this pipeline, mark it rolled back
        try {
          const activeRollout = await prisma.release.findFirst({
            where: {
              strategy: "CANARY",
              pipelineId: pipeline.id,
              status: { in: ["CANARY_DEPLOYED", "HEALTH_CHECK"] },
            },
          });
          if (activeRollout) {
            await prisma.release.update({
              where: { id: activeRollout.id, strategy: "CANARY" },
              data: {
                status: "ROLLED_BACK",
                rolledBackAt: new Date(),
              },
            });
            infoLog("auto-rollback", `Marked staged rollout ${activeRollout.id} as ROLLED_BACK`);
          }
        } catch (rolloutErr) {
          errorLog("auto-rollback", `Error updating staged rollout for pipeline ${pipeline.id}`, rolloutErr);
        }

        // Fire event alert
        await fireEventAlert("deploy_completed", pipeline.environmentId, {
          message: `Auto-rollback: Pipeline "${pipeline.name}" rolled back from v${latestVersion!.version} to v${previousVersion!.version} (error rate ${errorRate.toFixed(2)}% exceeded ${pipeline.autoRollbackThreshold}% threshold)`,
          pipelineId: pipeline.id,
        });

        // Broadcast SSE event
        broadcastSSE(
          {
            type: "pipeline_status",
            pipelineId: pipeline.id,
            action: "auto_rollback",
            message: `Auto-rollback triggered: error rate ${errorRate.toFixed(2)}% exceeded ${pipeline.autoRollbackThreshold}% threshold`,
            timestamp: Date.now(),
          },
          pipeline.environmentId,
        );

        infoLog("auto-rollback", `Successfully rolled back pipeline ${pipeline.id} (${pipeline.name})`);
      } catch (err) {
        // Per-pipeline error isolation — one failure doesn't stop others
        errorLog("auto-rollback", `Error processing pipeline ${pipeline.id}`, err);
      }
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const autoRollbackService = new AutoRollbackService();

export function initAutoRollbackService(): void {
  autoRollbackService.init();
}
