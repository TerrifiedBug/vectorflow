/**
 * Shared pipeline status derivation functions.
 *
 * These are the canonical implementations — all consumer files should
 * import from here instead of defining inline copies.
 */

/**
 * Returns the worst-case status across an array of process statuses.
 * Priority: CRASHED > STOPPED > STARTING > PENDING > RUNNING.
 * Returns null for an empty array.
 */
export function aggregateProcessStatus(
  statuses: Array<{ status: string }>
): "RUNNING" | "STARTING" | "STOPPED" | "CRASHED" | "PENDING" | null {
  if (statuses.length === 0) return null;
  if (statuses.some((s) => s.status === "CRASHED")) return "CRASHED";
  if (statuses.some((s) => s.status === "STOPPED")) return "STOPPED";
  if (statuses.some((s) => s.status === "STARTING")) return "STARTING";
  if (statuses.some((s) => s.status === "PENDING")) return "PENDING";
  return "RUNNING";
}

/**
 * Derives an overall pipeline status from its node statuses.
 * Logic: empty → PENDING, any CRASHED → CRASHED, any RUNNING → RUNNING,
 * any STARTING → STARTING, all STOPPED → STOPPED, else first node's status.
 */
export function derivePipelineStatus(
  nodes: Array<{ pipelineStatus: string }>
): string {
  if (nodes.length === 0) return "PENDING";
  if (nodes.some((n) => n.pipelineStatus === "CRASHED")) return "CRASHED";
  if (nodes.some((n) => n.pipelineStatus === "RUNNING")) return "RUNNING";
  if (nodes.some((n) => n.pipelineStatus === "STARTING")) return "STARTING";
  if (nodes.every((n) => n.pipelineStatus === "STOPPED")) return "STOPPED";
  return nodes[0].pipelineStatus;
}
