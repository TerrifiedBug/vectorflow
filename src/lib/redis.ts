import Redis from "ioredis";
import { infoLog, errorLog } from "@/lib/logger";

// ---------------------------------------------------------------------------
// globalThis cache — survives HMR in dev (same pattern as src/lib/prisma.ts)
// ---------------------------------------------------------------------------
const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

/**
 * Redact the password portion of a Redis URL for safe logging.
 * Handles both `redis://:password@host` and `redis://user:password@host`.
 * URLs without credentials are returned unchanged.
 */
export function redactRedisUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    // If it's not a valid URL, return a fully redacted placeholder
    return "redis://***@<invalid-url>";
  }
}

/**
 * Return a lazily-connected ioredis singleton, or `null` when `REDIS_URL`
 * is not configured (single-instance / graceful degradation mode).
 */
export function getRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  if (globalForRedis.redis) return globalForRedis.redis;

  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      const delay = Math.min(100 * Math.pow(2, times - 1), 5000);
      return delay;
    },
  });

  // Connection lifecycle logging
  client.on("connect", () => {
    infoLog("redis", "Connected");
  });

  client.on("error", (err: Error) => {
    errorLog("redis", `Connection error (${redactRedisUrl(url)}): ${err.message}`);
  });

  client.on("close", () => {
    infoLog("redis", "Connection closed");
  });

  // Kick off the lazy connection — fire-and-forget; errors surface via
  // the "error" event listener above.
  client.connect().catch(() => {
    // Already handled by the "error" event listener
  });

  globalForRedis.redis = client;
  return client;
}

/**
 * Returns `true` when a Redis client exists **and** its connection status
 * is `ready` (fully connected and accepting commands).
 */
export function isRedisAvailable(): boolean {
  const client = getRedis();
  return client !== null && client.status === "ready";
}
