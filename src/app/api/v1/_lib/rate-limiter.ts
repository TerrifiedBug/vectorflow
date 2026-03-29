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

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
}

export class RateLimiter {
  /** key = `${serviceAccountId}:${tier}` */
  private windows = new Map<string, SlidingWindow>();

  check(
    serviceAccountId: string,
    tier: RateLimitTier,
    customLimit?: number | null,
  ): RateLimitResult {
    const limit = customLimit ?? TIER_LIMITS[tier];
    const key = `${serviceAccountId}:${tier}`;
    const now = Date.now();
    const cutoff = now - WINDOW_MS;

    let window = this.windows.get(key);
    if (!window) {
      window = { timestamps: [] };
      this.windows.set(key, window);
    }

    // Remove expired entries
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

  /** Rate-limit by an explicit key (no tier suffix appended). */
  checkKey(key: string, limit: number): RateLimitResult {
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

/** Singleton in-memory rate limiter. */
export const rateLimiter = new RateLimiter();

// Periodically clean up stale sliding windows to prevent memory leaks
if (typeof setInterval !== "undefined") {
  setInterval(() => rateLimiter.cleanup(), 120_000);
}
