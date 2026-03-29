import { prisma } from "@/lib/prisma";
import {
  evaluateAllPipelines,
  ANOMALY_CONFIG,
} from "@/server/services/anomaly-detector";

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
    console.log("[anomaly-detection] Initializing...");
    this.start();
  }

  start(): void {
    this.timer = setInterval(
      () => void this.tick(),
      ANOMALY_CONFIG.POLL_INTERVAL_MS,
    );
    this.timer.unref();
    console.log(
      `[anomaly-detection] Poll loop started (every ${ANOMALY_CONFIG.POLL_INTERVAL_MS / 1000}s)`,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[anomaly-detection] Poll loop stopped");
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  /**
   * Single tick of the detection loop.
   * Runs anomaly evaluation and periodic cleanup.
   */
  private async tick(): Promise<void> {
    this.tickCount++;

    try {
      await evaluateAllPipelines();
    } catch (err) {
      console.error("[anomaly-detection] Evaluation error:", err);
    }

    // Run cleanup once per day
    if (this.tickCount % CLEANUP_INTERVAL_TICKS === 0) {
      try {
        await this.cleanup();
      } catch (err) {
        console.error("[anomaly-detection] Cleanup error:", err);
      }
    }
  }

  /**
   * Remove old dismissed and resolved anomaly events beyond the retention window.
   */
  private async cleanup(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600_000);

    const result = await prisma.anomalyEvent.deleteMany({
      where: {
        status: { in: ["dismissed"] },
        detectedAt: { lt: cutoff },
      },
    });

    if (result.count > 0) {
      console.log(
        `[anomaly-detection] Cleaned up ${result.count} old anomaly events`,
      );
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const anomalyDetectionService = new AnomalyDetectionService();

export function initAnomalyDetectionService(): void {
  anomalyDetectionService.init();
}
