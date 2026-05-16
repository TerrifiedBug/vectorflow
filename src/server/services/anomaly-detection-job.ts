import { prisma } from "@/lib/prisma";
import {
  evaluateAllPipelines,
  ANOMALY_CONFIG,
} from "@/server/services/anomaly-detector";
import { infoLog, errorLog } from "@/lib/logger";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Run cleanup every 24 hours (in number of ticks). */
const CLEANUP_INTERVAL_TICKS = Math.floor(
  (24 * 3600_000) / ANOMALY_CONFIG.POLL_INTERVAL_MS,
);

/** Retain dismissed/acknowledged anomaly events for 30 days. */
const RETENTION_DAYS = 30;

// ─── AnomalyDetectionService ───────────────────────────────────────────────

export class AnomalyDetectionService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;

  init(): void {
    infoLog("anomaly-detection", "Initializing...");
    this.start();
  }

  start(): void {
    this.timer = setInterval(
      () => void this.tick(),
      ANOMALY_CONFIG.POLL_INTERVAL_MS,
    );
    this.timer.unref();
    infoLog("anomaly-detection", `Poll loop started (every ${ANOMALY_CONFIG.POLL_INTERVAL_MS / 1000}s)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      infoLog("anomaly-detection", "Poll loop stopped");
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  /**
   * Single tick of the detection loop. Fans out across orgs so that one
   * tenant's analysis (or failure) does not stall another's.
   */
  private async tick(): Promise<void> {
    this.tickCount++;

    const orgs = await prisma.organization.findMany({
      where: { suspendedAt: null, deletedAt: null },
      select: { id: true },
    });
    for (const org of orgs) {
      try {
        await evaluateAllPipelines({ organizationId: org.id });
      } catch (err) {
        errorLog(
          "anomaly-detection",
          `org=${org.id} evaluation error (continuing)`,
          err,
        );
      }
    }

    // Run cleanup once per day, also per-org for tenant isolation.
    if (this.tickCount % CLEANUP_INTERVAL_TICKS === 0) {
      for (const org of orgs) {
        try {
          await this.cleanupForOrg(org.id);
        } catch (err) {
          errorLog(
            "anomaly-detection",
            `org=${org.id} cleanup error (continuing)`,
            err,
          );
        }
      }
    }
  }

  /**
   * Remove old dismissed anomaly events for a single org beyond the
   * retention window. Scoped by `organizationId` so an operator-role
   * cleanup never sweeps across tenants.
   */
  private async cleanupForOrg(organizationId: string): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600_000);

    const result = await prisma.anomalyEvent.deleteMany({
      where: {
        organizationId,
        status: { in: ["dismissed"] },
        detectedAt: { lt: cutoff },
      },
    });

    if (result.count > 0) {
      infoLog(
        "anomaly-detection",
        `org=${organizationId} cleaned up ${result.count} old anomaly events`,
      );
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const anomalyDetectionService = new AnomalyDetectionService();

export function initAnomalyDetectionService(): void {
  anomalyDetectionService.init();
}
