import type { PushMessage } from "@/server/services/push-types";
import { pushRegistry } from "@/server/services/push-registry";
import { publishPush } from "@/server/services/redis-pubsub";
import { getRedis } from "@/lib/redis";

export type DeliveryMode = "local" | "redis" | "unreachable";

/**
 * Attempt to deliver a push message to a specific agent node and report HOW it
 * was delivered.
 *
 * - "local"      — agent is SSE-connected to this instance; delivered now.
 * - "redis"      — agent is on another instance; published, but receipt is not
 *                  confirmed.
 * - "unreachable" — no local connection and Redis is unavailable.
 */
export function deliverPush(nodeId: string, message: PushMessage): DeliveryMode {
  if (pushRegistry.send(nodeId, message)) {
    return "local";
  }
  if (getRedis()) {
    publishPush(nodeId, message);
    return "redis";
  }
  return "unreachable";
}

/**
 * Try LOCAL SSE delivery only, without falling through to Redis. Use this when
 * you need to probe whether an agent is reachable on this instance before
 * deciding whether to bind a request to a single node or fan out via Redis —
 * the caller doesn't want a probe to side-effect a Redis publish that another
 * instance might pick up and act on.
 */
export function tryLocalPush(nodeId: string, message: PushMessage): boolean {
  return pushRegistry.send(nodeId, message);
}

/**
 * Backwards-compatible boolean wrapper. NOTE: a `true` return only means
 * "we tried" — Redis publication is fire-and-forget. Callers that need
 * confirmed delivery should use `deliverPush` and branch on `"local"`.
 */
export function relayPush(nodeId: string, message: PushMessage): boolean {
  return deliverPush(nodeId, message) !== "unreachable";
}
