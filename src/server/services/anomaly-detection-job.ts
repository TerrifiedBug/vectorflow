import { adminPrisma, prisma } from "@/lib/prisma";
import { runWithOrgContext } from "@/lib/org-context";
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
  /**
   * True while a tick is currently executing. The per-org fan-out can
   * exceed POLL_INTERVAL_MS in fleets with many tenants; setInterval
   * does NOT skip overlapping callbacks, so without this guard two
   * ticks could run concurrently and double-process every org.
   */
  private tickInFlight = false;
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
    if (this.tickInFlight) {
      infoLog(
        "anomaly-detection",
        "Previous tick still in flight; skipping this interval to avoid overlap",
      );
      return;
    }
    this.tickInFlight = true;
    try {
      await this.runTickBody();
    } finally {
      this.tickInFlight = false;
    }
  }

  private async runTickBody(): Promise<void> {
    this.tickCount++;

    // The org lookup itself can fail under DB pressure. Catching here
    // keeps the setInterval-driven loop alive: `start()` invokes
    // `void this.tick()`, so an unhandled rejection here would surface
    // as an unhandled promise rejection and (on some runtimes) end the
    // process \u2014 stopping all future ticks. A logged error and an early
    // return is the correct failure mode: next tick gets another go.
    let orgs: Array<{ id: string }>;
    try {
      orgs = await adminPrisma.organization.findMany({
        where: { suspendedAt: null, deletedAt: null },
        select: { id: true },
      });
    } catch (err) {
      errorLog(
        "anomaly-detection",
        "Failed to list organizations for tick (skipping this cycle)",
        err,
      );
      return;
    }

    for (const org of orgs) {
      try {
        await runWithOrgContext(org.id, () =>
          evaluateAllPipelines({ organizationId: org.id }),
        );
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
          await runWithOrgContext(org.id, () => this.cleanupForOrg(org.id));
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
