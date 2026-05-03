import { randomUUID } from "crypto";
import { getRedis } from "@/lib/redis";

export type RateLimitTier = "read" | "default" | "deploy";

const TIER_LIMITS: Record<RateLimitTier, number> = {
  read: 200,
  default: 100,
  deploy: 20,
};

const WINDOW_MS = 60_000; // 1 minute

interface SlidingWindow {
  timestamps: number[];
}

interface RedisRateLimitStore {
  eval(
    script: string,
    keyCount: number,
    key: string,
    now: string,
    cutoff: string,
    limit: string,
    windowMs: string,
    member: string,
  ): Promise<unknown>;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
}

const REDIS_SLIDING_WINDOW_SCRIPT = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[2])
local count = redis.call("ZCARD", KEYS[1])
if count >= tonumber(ARGV[3]) then
  local oldest = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")
  return {0, count, oldest[2] or ARGV[1]}
end
redis.call("ZADD", KEYS[1], ARGV[1], ARGV[5])
redis.call("PEXPIRE", KEYS[1], ARGV[4])
return {1, count + 1, 0}
`;

export class RateLimiter {
  /** key = `${serviceAccountId}:${tier}` */
  private windows = new Map<string, SlidingWindow>();
  private redis: RedisRateLimitStore | null;

  constructor(options: { redis?: RedisRateLimitStore | null } = {}) {
    this.redis = options.redis === undefined ? getRedis() : options.redis;
  }

  check(
    serviceAccountId: string,
    tier: RateLimitTier,
    customLimit?: number | null,
  ): Promise<RateLimitResult> {
    const limit = customLimit ?? TIER_LIMITS[tier];
    const key = `${serviceAccountId}:${tier}`;
    return this.checkKey(key, limit);
  }

  /** Rate-limit by an explicit key (no tier suffix appended). */
  async checkKey(key: string, limit: number): Promise<RateLimitResult> {
    if (this.redis) {
      return this.checkRedisKey(key, limit);
    }

    return this.checkMemoryKey(key, limit);
  }

  private async checkRedisKey(key: string, limit: number): Promise<RateLimitResult> {
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    const result = await this.redis!.eval(
      REDIS_SLIDING_WINDOW_SCRIPT,
      1,
      `rate-limit:${key}`,
      String(now),
      String(cutoff),
      String(limit),
      String(WINDOW_MS),
      `${now}:${randomUUID()}`,
    );
    const [allowedFlag, count, oldest] = parseRedisResult(result);

    if (!allowedFlag) {
      const retryAfter = Math.ceil((oldest + WINDOW_MS - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.max(retryAfter, 1),
      };
    }

    return {
      allowed: true,
      remaining: Math.max(limit - count, 0),
      retryAfter: 0,
    };
  }

  private checkMemoryKey(key: string, limit: number): RateLimitResult {
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    let window = this.windows.get(key);
    if (!window) {
      window = { timestamps: [] };
      this.windows.set(key, window);
    }

    window.timestamps = window.timestamps.filter((t) => t > cutoff);

    if (window.timestamps.length >= limit) {
      const oldestInWindow = window.timestamps[0];
      const retryAfter = Math.ceil((oldestInWindow + WINDOW_MS - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.max(retryAfter, 1),
      };
    }

    window.timestamps.push(now);
    return {
      allowed: true,
      remaining: limit - window.timestamps.length,
      retryAfter: 0,
    };
  }

  /** Periodic cleanup of stale windows (call from a setInterval). */
  cleanup(): void {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [key, window] of this.windows) {
      window.timestamps = window.timestamps.filter((t) => t > cutoff);
      if (window.timestamps.length === 0) {
        this.windows.delete(key);
      }
    }
  }
}

function parseRedisResult(result: unknown): [boolean, number, number] {
  if (!Array.isArray(result) || result.length < 3) {
    throw new Error("Unexpected Redis rate-limit result");
  }

  const allowed = Number(result[0]) === 1;
  const count = Number(result[1]);
  const oldest = Number(result[2]);

  if (!Number.isFinite(count) || !Number.isFinite(oldest)) {
    throw new Error("Unexpected Redis rate-limit counters");
  }

  return [allowed, count, oldest];
}

/** Singleton Redis-backed rate limiter, falling back to local memory when Redis is not configured. */
export const rateLimiter = new RateLimiter();

// Periodically clean up stale sliding windows to prevent memory leaks
if (typeof setInterval !== "undefined") {
  setInterval(() => rateLimiter.cleanup(), 120_000);
}
