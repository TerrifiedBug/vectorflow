import { checkNodeHealth } from "@/server/services/fleet-health";
import { infoLog, errorLog } from "@/lib/logger";

// Sweep every 30s. Node-offline detection used to run ONLY when an inbound
// heartbeat arrived, so a fully-silent fleet (every agent gone) was never
// marked UNREACHABLE and node_left alerts never fired. This leader-gated
// interval guarantees the sweep runs even when no heartbeats are coming in.
const SWEEP_INTERVAL_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;

export function initFleetHealthScheduler(): void {
  if (timer) return;

  const tick = () => {
    void checkNodeHealth().catch((err) =>
      errorLog("fleet-health", "node health sweep failed", err)
    );
  };

  // Run once on startup, then on the interval.
  tick();
  timer = setInterval(tick, SWEEP_INTERVAL_MS);
  // Don't keep the process alive for this background sweep.
  timer.unref?.();

  infoLog("fleet-health", `fleet health scheduler started (every ${SWEEP_INTERVAL_MS}ms)`);
}

export function _stopFleetHealthSchedulerForTests(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
