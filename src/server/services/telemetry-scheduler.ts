import cron, { type ScheduledTask } from "node-cron";
import { sendTelemetryHeartbeat } from "./telemetry-sender";
import { debugLog } from "@/lib/logger";
import { isLeader } from "@/server/services/leader-election";

// Daily at 03:42 UTC. Jitter across instances happens naturally because each
// VF install runs at a different wall clock when the cron crosses the boundary.
const DAILY_CRON = "42 3 * * *";

let task: ScheduledTask | null = null;

export function initTelemetryScheduler(): void {
  if (task) return;
  task = cron.schedule(DAILY_CRON, async () => {
    // SC-3: a demoted leader's cron keeps firing for up to one TTL (~15s) after
    // Redis renewals fail. Re-check leadership so only the current leader sends
    // the telemetry heartbeat. Guard only — the cron task is left registered.
    if (!isLeader()) {
      debugLog("telemetry", "Skipping heartbeat — instance is no longer leader");
      return;
    }
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
