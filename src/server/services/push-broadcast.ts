import type { PushMessage } from "@/server/services/push-types";
import { pushRegistry } from "@/server/services/push-registry";
import { publishPush } from "@/server/services/redis-pubsub";
import { getRedis } from "@/lib/redis";

/**
 * Attempt to deliver a push message to a specific agent node.
 *
 * 1. Try local delivery via pushRegistry.send() — if the agent is connected
 *    to this instance, the message is delivered immediately.
 * 2. If local delivery fails and Redis is available, publish via Redis pub/sub
 *    so another instance can deliver it.
 * 3. If local delivery fails and Redis is unavailable, return false —
 *    the agent is not reachable (it will pick up changes on next heartbeat).
 *
 * @returns true if delivered locally or relayed via Redis, false if unreachable
 */
export function relayPush(nodeId: string, message: PushMessage): boolean {
  // Try local delivery first
  if (pushRegistry.send(nodeId, message)) {
    return true;
  }

  // Local delivery failed — relay via Redis if available
  if (getRedis()) {
    publishPush(nodeId, message);
    return true;
  }

  // Agent not reachable on any instance
  return false;
}
