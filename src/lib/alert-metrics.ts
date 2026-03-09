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
] as const;

export const EVENT_METRICS: ReadonlySet<string> = new Set(EVENT_METRIC_VALUES);

/** Returns true if the given metric string is event-based (fires inline). */
export function isEventMetric(metric: string): boolean {
  return EVENT_METRICS.has(metric);
}
