import type Redis from "ioredis";
import type { SSEEvent, MetricUpdateEvent } from "@/lib/sse/types";
import { getRedis } from "@/lib/redis";
import { leaderElection } from "@/server/services/leader-election";
import { sseRegistry } from "@/server/services/sse-registry";
import { metricStore } from "@/server/services/metric-store";

// ─── Constants ──────────────────────────────────────────────────────────────

const CHANNEL = "vectorflow:events";

// ─── Envelope Type ──────────────────────────────────────────────────────────

export interface PubSubEnvelope {
  type: "sse" | "metric";
  originInstanceId: string;
  environmentId: string;
  payload: SSEEvent | MetricUpdateEvent[];
}

// ─── Module State ───────────────────────────────────────────────────────────

let subscriber: Redis | null = null;

// ─── Init / Shutdown ────────────────────────────────────────────────────────

/**
 * Creates a subscriber connection via `getRedis()!.duplicate()` when Redis
 * is available, and subscribes to the `vectorflow:events` channel.
 * No-op when `getRedis()` returns null (single-instance mode).
 */
export async function initPubSub(): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    console.log(
      "[redis-pubsub] No Redis configured — pub/sub disabled (single-instance mode)",
    );
    return;
  }

  subscriber = redis.duplicate();

  subscriber.on("error", (err: Error) => {
    console.error(`[redis-pubsub] Subscriber error: ${err.message}`);
  });

  subscriber.on("message", (_channel: string, message: string) => {
    handleMessage(message);
  });

  await subscriber.subscribe(CHANNEL);
  console.log(`[redis-pubsub] Subscribed to channel: ${CHANNEL}`);
}

/**
 * Unsubscribe and disconnect the subscriber connection.
 * Used for clean test teardown and graceful shutdown.
 */
export async function shutdownPubSub(): Promise<void> {
  if (!subscriber) return;

  try {
    await subscriber.unsubscribe(CHANNEL);
    subscriber.disconnect();
    console.log("[redis-pubsub] Subscriber disconnected");
  } catch (err) {
    console.error(
      `[redis-pubsub] Error during shutdown: ${(err as Error).message}`,
    );
  } finally {
    subscriber = null;
  }
}

// ─── Publish ────────────────────────────────────────────────────────────────

/**
 * Publish an SSE event to all instances via Redis pub/sub.
 * Fire-and-forget with `.catch()` logging. No-op when Redis unavailable.
 */
export function publishSSE(event: SSEEvent, environmentId: string): void {
  const redis = getRedis();
  if (!redis) return;

  const envelope: PubSubEnvelope = {
    type: "sse",
    originInstanceId: leaderElection.instanceId,
    environmentId,
    payload: event,
  };

  redis.publish(CHANNEL, JSON.stringify(envelope)).catch((err: Error) => {
    console.error(`[redis-pubsub] Publish SSE error: ${err.message}`);
  });
}

/**
 * Publish metric update events to all instances via Redis pub/sub.
 * Fire-and-forget with `.catch()` logging. No-op when Redis unavailable.
 */
export function publishMetrics(
  events: MetricUpdateEvent[],
  environmentId: string,
): void {
  const redis = getRedis();
  if (!redis) return;

  const envelope: PubSubEnvelope = {
    type: "metric",
    originInstanceId: leaderElection.instanceId,
    environmentId,
    payload: events,
  };

  redis.publish(CHANNEL, JSON.stringify(envelope)).catch((err: Error) => {
    console.error(`[redis-pubsub] Publish metrics error: ${err.message}`);
  });
}

// ─── Subscriber Message Handler ─────────────────────────────────────────────

function handleMessage(message: string): void {
  let envelope: PubSubEnvelope;
  try {
    envelope = JSON.parse(message);
  } catch {
    console.warn(
      `[redis-pubsub] Malformed message (not valid JSON), skipping: ${message.slice(0, 200)}`,
    );
    return;
  }

  // Echo prevention — skip messages published by this instance
  if (envelope.originInstanceId === leaderElection.instanceId) {
    return;
  }

  if (envelope.type === "sse") {
    // Deliver SSE event to local browser connections
    sseRegistry.broadcast(
      envelope.payload as SSEEvent,
      envelope.environmentId,
    );
  } else if (envelope.type === "metric") {
    // Merge remote metric samples into local store and broadcast each to local SSE
    const events = envelope.payload as MetricUpdateEvent[];
    for (const event of events) {
      metricStore.mergeSample(
        event.nodeId,
        event.pipelineId,
        event.componentId,
        event.sample,
      );
      sseRegistry.broadcast(event, envelope.environmentId);
    }
  }
}

// Exported for testing
export { handleMessage as _handleMessageForTest };
