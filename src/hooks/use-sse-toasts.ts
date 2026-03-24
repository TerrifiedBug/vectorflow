"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useSSE } from "@/hooks/use-sse";
import type { SSEEvent } from "@/lib/sse/types";

// ── Toast Config Types ───────────────────────────────────────────────

export type ToastConfig = {
  type: "error" | "warning" | "success" | "info";
  message: string;
  dedupeKey: string;
} | null;

// ── Constants ────────────────────────────────────────────────────────

const COOLDOWN_MS = 30_000;
const CLEANUP_INTERVAL_MS = 60_000;

// ── Pure dispatch logic (exported for testing) ───────────────────────

/**
 * Maps an SSE event to a toast configuration, or null if the event
 * should not produce a toast.
 */
export function getToastConfig(event: SSEEvent): ToastConfig {
  if (event.type === "status_change") {
    // Pipeline crashed
    if (event.toStatus === "CRASHED" && event.pipelineId) {
      const name = event.pipelineName || event.pipelineId;
      return {
        type: "error",
        message: `Pipeline "${name}" crashed`,
        dedupeKey: `crash:${event.pipelineId}`,
      };
    }

    // Pipeline deployed
    if (event.toStatus === "DEPLOYED" && event.pipelineId) {
      const name = event.pipelineName || event.pipelineId;
      return {
        type: "success",
        message: `Pipeline "${name}" deployed successfully`,
        dedupeKey: `deploy:${event.pipelineId}`,
      };
    }

    // Everything else (STARTING→RUNNING, recovery, etc.) — no toast
    return null;
  }

  if (event.type === "fleet_status") {
    // Node went offline — fires when a server-side watchdog detects
    // heartbeat timeout and broadcasts a fleet_status with OFFLINE.
    // Currently the heartbeat handler only emits HEALTHY; a future
    // node-health timeout service will emit OFFLINE fleet_status events.
    if (event.status === "OFFLINE") {
      return {
        type: "warning",
        message: "Node went offline",
        dedupeKey: `offline:${event.nodeId}`,
      };
    }
    return null;
  }

  // metric_update, log_entry, etc. — no toast
  return null;
}

// ── Cooldown dedup helpers (exported for testing) ────────────────────

export function isWithinCooldown(
  dedupeMap: Map<string, number>,
  key: string,
  now: number,
): boolean {
  const lastFired = dedupeMap.get(key);
  return lastFired !== undefined && now - lastFired < COOLDOWN_MS;
}

export function cleanExpiredEntries(
  dedupeMap: Map<string, number>,
  now: number,
): void {
  for (const [key, timestamp] of dedupeMap) {
    if (now - timestamp >= COOLDOWN_MS) {
      dedupeMap.delete(key);
    }
  }
}

// ── Toast dispatch helper ────────────────────────────────────────────

function fireToast(config: NonNullable<ToastConfig>): void {
  switch (config.type) {
    case "error":
      toast.error(config.message);
      break;
    case "warning":
      toast.warning(config.message);
      break;
    case "success":
      toast.success(config.message);
      break;
    case "info":
      toast.info(config.message);
      break;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────

/**
 * Subscribes to SSE `status_change` and `fleet_status` events and
 * dispatches sonner toasts for pipeline crashes, deploys, and node
 * offline events. Deduplicates within a 30-second cooldown window.
 *
 * Call once in the dashboard layout alongside `useSSE()`.
 */
export function useSSEToasts(): void {
  const { subscribe, unsubscribe } = useSSE();
  const dedupeMapRef = useRef(new Map<string, number>());

  useEffect(() => {
    const handler = (event: SSEEvent) => {
      const config = getToastConfig(event);
      if (!config) return;

      const now = Date.now();
      if (isWithinCooldown(dedupeMapRef.current, config.dedupeKey, now)) return;

      dedupeMapRef.current.set(config.dedupeKey, now);
      fireToast(config);
    };

    const subIds = [
      subscribe("status_change", handler),
      subscribe("fleet_status", handler),
    ];

    // Periodic cleanup of expired dedup entries
    const cleanupTimer = setInterval(() => {
      cleanExpiredEntries(dedupeMapRef.current, Date.now());
    }, CLEANUP_INTERVAL_MS);

    return () => {
      for (const id of subIds) {
        unsubscribe(id);
      }
      clearInterval(cleanupTimer);
    };
  }, [subscribe, unsubscribe]);
}
