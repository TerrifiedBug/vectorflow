import cron, { type ScheduledTask } from "node-cron";
import { sendTelemetryHeartbeat } from "./telemetry-sender";

// Daily at 03:42 UTC. Jitter across instances happens naturally because each
// VF install runs at a different wall clock when the cron crosses the boundary.
const DAILY_CRON = "42 3 * * *";

let task: ScheduledTask | null = null;

export function initTelemetryScheduler(): void {
  if (task) return;
  task = cron.schedule(DAILY_CRON, async () => {
    try {
      await sendTelemetryHeartbeat();
    } catch (err) {
      console.error("[telemetry] cron handler error:", err);
    }
  });
}

export function _stopTelemetrySchedulerForTests(): void {
  if (task) {
    task.stop();
    task = null;
  }
}
