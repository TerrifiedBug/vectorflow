import type { SSEEvent, MetricUpdateEvent } from "@/lib/sse/types";
import { sseRegistry } from "@/server/services/sse-registry";
import { publishSSE, publishMetrics } from "@/server/services/redis-pubsub";

/**
 * Broadcast an SSE event to local browser connections AND publish to Redis
 * for cross-instance delivery.
 *
 * This is the primary entry point for all SSE event broadcasting —
 * use this instead of calling sseRegistry.broadcast() directly.
 */
export function broadcastSSE(event: SSEEvent, environmentId: string): void {
  // Local delivery first
  sseRegistry.broadcast(event, environmentId);

  // Cross-instance delivery via Redis pub/sub (no-op if Redis unavailable)
  publishSSE(event, environmentId);
}

/**
 * Publish metric update events to Redis for cross-instance delivery only.
 * Local SSE broadcast is handled per-event by the caller (heartbeat flush loop).
 */
export function broadcastMetrics(
  events: MetricUpdateEvent[],
  environmentId: string,
): void {
  // Cross-instance delivery only — local broadcast is handled by the caller
  publishMetrics(events, environmentId);
}
