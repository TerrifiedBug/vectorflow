/**
 * Shared constants for event-based alert metrics.
 *
 * This file is safe to import from both client ("use client") and server code
 * because it has no Node.js / Prisma dependencies — only plain values.
 */

export const EVENT_METRIC_VALUES = [
  "deploy_requested",
  "deploy_completed",
  "deploy_rejected",
  "deploy_cancelled",
  "new_version_available",
  "scim_sync_failed",
  "backup_failed",
  "certificate_expiring",
  "node_joined",
  "node_left",
  "git_sync_failed",
] as const;

export const EVENT_METRICS: ReadonlySet<string> = new Set(EVENT_METRIC_VALUES);

/** Returns true if the given metric string is event-based (fires inline). */
export function isEventMetric(metric: string): boolean {
  return EVENT_METRICS.has(metric);
}

// ---------------------------------------------------------------------------
// Fleet-scoped metrics — evaluated by FleetAlertService, not per-node
// heartbeat. Client-safe: no Node.js / Prisma deps.
// ---------------------------------------------------------------------------

export const FLEET_METRIC_VALUES = [
  "fleet_error_rate",
  "fleet_throughput_drop",
  "fleet_event_volume",
  "node_load_imbalance",
  "version_drift",
  "cost_threshold_exceeded",
] as const;

export const FLEET_METRICS_SET: ReadonlySet<string> = new Set(FLEET_METRIC_VALUES);

/** Returns true if the given metric string is a fleet-scoped metric. */
export function isFleetMetric(metric: string): boolean {
  return FLEET_METRICS_SET.has(metric);
}

/**
 * Classify an alert metric into a display category.
 * Informational = event-based metrics (fires inline, not threshold).
 * Actionable = everything else (threshold + fleet metrics).
 */
export function getAlertCategory(metric: string): "actionable" | "informational" {
  return isEventMetric(metric) ? "informational" : "actionable";
}

// Note: log_keyword is intentionally NOT in EVENT_METRICS. Although keyword
// alerts fire on log matches (event-like), they use threshold counting and
// should appear in the "actionable" category alongside other threshold metrics.
