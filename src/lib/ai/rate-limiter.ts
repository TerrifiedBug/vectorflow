// src/lib/ai/rate-limiter.ts

/**
 * In-memory token bucket rate limiter.
 * Tracks per-team request counts with a fixed window.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

const DEFAULT_MAX_REQUESTS = 60;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

export function checkRateLimit(
  teamId: string,
  maxRequests = DEFAULT_MAX_REQUESTS,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let bucket = buckets.get(teamId);

  if (!bucket || now - bucket.lastRefill >= WINDOW_MS) {
    bucket = { tokens: maxRequests, lastRefill: now };
    buckets.set(teamId, bucket);
  }

  const resetAt = bucket.lastRefill + WINDOW_MS;

  if (bucket.tokens <= 0) {
    return { allowed: false, remaining: 0, resetAt };
  }

  bucket.tokens -= 1;
  return { allowed: true, remaining: bucket.tokens, resetAt };
}
