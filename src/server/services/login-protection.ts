import type Redis from "ioredis";
import { getRedis } from "@/lib/redis";

/**
 * Login brute-force protection.
 *
 * Tracks failed login attempts per account (email). The in-memory `Map` is a
 * per-process fast-path; when Redis is configured the authoritative counter
 * lives in the shared store so the lockout threshold is evaluated
 * cluster-wide and survives process restarts (VF-17). When the failure
 * threshold is reached, the caller is responsible for writing lockedAt to the
 * DB. On successful login, the caller clears the counter.
 *
 * Single-instance mode (no REDIS_URL): in-memory only (counters reset on
 * restart, but DB lockedAt persists across restarts).
 * HA mode (Redis configured): the shared counter is authoritative across
 * every node; the in-memory map is kept only as a fast-path cache and as a
 * fallback when a Redis command fails.
 */

export const ACCOUNT_LOCKOUT_THRESHOLD = 10; // failed attempts before lock
export const ACCOUNT_LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
export const TOTP_RATE_LIMIT = 5; // TOTP attempts per window
export const TOTP_RATE_WINDOW_MS = 5 * 60 * 1000; // 5-minute window

interface FailureWindow {
  count: number;
  lastFailureAt: number;
}

/** Redis key namespace for the shared (cluster-wide) password-failure counter. */
const REDIS_FAILURE_PREFIX = "vectorflow:login-failures:";

export class LoginAttemptTracker {
  private readonly failures = new Map<string, FailureWindow>();
  /** Separate map so TOTP rate-limit checks never mix with password failures. */
  private readonly totpFailures = new Map<string, FailureWindow>();

  /**
   * Resolver for the shared store. Defaults to the lazily-connected ioredis
   * singleton; injectable so tests can supply a fake or force single-instance
   * (in-memory) behaviour by returning null.
   */
  private readonly getRedisClient: () => Redis | null;

  constructor(getRedisClient: () => Redis | null = getRedis) {
    this.getRedisClient = getRedisClient;
  }

  /**
   * Record a failed login attempt for the given identifier (email).
   * Returns the new total failure count.
   */
  recordFailure(identifier: string): number {
    const now = Date.now();
    const normalized = identifier.toLowerCase().trim();
    const existing = this.failures.get(normalized);

    if (!existing) {
      this.failures.set(normalized, { count: 1, lastFailureAt: now });
      return 1;
    }

    existing.count += 1;
    existing.lastFailureAt = now;
    return existing.count;
  }

  /**
   * Return the current failure count for the identifier.
   */
  getFailureCount(identifier: string): number {
    const normalized = identifier.toLowerCase().trim();
    return this.failures.get(normalized)?.count ?? 0;
  }

  /**
   * Clear the failure counter (call on successful login).
   */
  clearFailures(identifier: string): void {
    const normalized = identifier.toLowerCase().trim();
    this.failures.delete(normalized);
  }

  /**
   * Cluster-wide variant of {@link recordFailure}. Increments both the
   * in-memory fast-path counter and (when Redis is configured) a shared
   * counter keyed by normalized email, then returns the higher of the two so
   * the lockout threshold is evaluated across every node and survives
   * restarts (VF-17). The shared counter uses a sliding TTL equal to the
   * lockout duration. Falls back to the in-memory count when Redis is absent
   * or a command fails.
   */
  async recordFailureShared(identifier: string): Promise<number> {
    const localCount = this.recordFailure(identifier);
    const redis = this.getRedisClient();
    if (!redis) return localCount;

    const normalized = identifier.toLowerCase().trim();
    const key = REDIS_FAILURE_PREFIX + normalized;
    try {
      const sharedCount = await redis.incr(key);
      // Sliding window: refresh the TTL on every failure so the counter
      // expires ACCOUNT_LOCKOUT_DURATION_MS after the LAST failure, matching
      // the in-memory cleanup semantics.
      await redis.pexpire(key, ACCOUNT_LOCKOUT_DURATION_MS);
      return Math.max(localCount, sharedCount);
    } catch {
      // Redis unavailable — degrade to the in-memory fast-path count.
      return localCount;
    }
  }

  /**
   * Cluster-wide variant of {@link getFailureCount}. Returns the higher of
   * the in-memory and shared counts. Falls back to in-memory on Redis error.
   */
  async getFailureCountShared(identifier: string): Promise<number> {
    const localCount = this.getFailureCount(identifier);
    const redis = this.getRedisClient();
    if (!redis) return localCount;

    const normalized = identifier.toLowerCase().trim();
    const key = REDIS_FAILURE_PREFIX + normalized;
    try {
      const raw = await redis.get(key);
      const sharedCount = raw ? Number(raw) : 0;
      return Math.max(localCount, Number.isFinite(sharedCount) ? sharedCount : 0);
    } catch {
      return localCount;
    }
  }

  /**
   * Cluster-wide variant of {@link clearFailures}. Clears both the in-memory
   * fast-path counter and the shared Redis counter (call on successful
   * login). Best-effort on the Redis side.
   */
  async clearFailuresShared(identifier: string): Promise<void> {
    this.clearFailures(identifier);
    const redis = this.getRedisClient();
    if (!redis) return;

    const normalized = identifier.toLowerCase().trim();
    try {
      await redis.del(REDIS_FAILURE_PREFIX + normalized);
    } catch {
      // Best-effort; the shared counter will expire via its TTL.
    }
  }

  /**
   * Record a failed TOTP attempt for the given identifier (email).
   * Tracked separately from password failures so the TOTP rate limit
   * (TOTP_RATE_LIMIT) is only triggered by actual TOTP failures, not by a
   * mix of password + TOTP failures.
   * Returns the new TOTP failure count.
   */
  recordTotpFailure(identifier: string): number {
    const now = Date.now();
    const normalized = identifier.toLowerCase().trim();
    const existing = this.totpFailures.get(normalized);

    if (!existing) {
      this.totpFailures.set(normalized, { count: 1, lastFailureAt: now });
      return 1;
    }

    existing.count += 1;
    existing.lastFailureAt = now;
    return existing.count;
  }

  /**
   * Return the current TOTP failure count for the identifier.
   */
  getTotpFailureCount(identifier: string): number {
    const normalized = identifier.toLowerCase().trim();
    return this.totpFailures.get(normalized)?.count ?? 0;
  }

  /**
   * Clear the TOTP failure counter (call on successful login).
   */
  clearTotpFailures(identifier: string): void {
    const normalized = identifier.toLowerCase().trim();
    this.totpFailures.delete(normalized);
  }

  /**
   * Remove stale entries (optional periodic cleanup).
   * Entries older than maxAgeMs are purged.
   */
  cleanup(maxAgeMs = ACCOUNT_LOCKOUT_DURATION_MS): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [key, window] of this.failures) {
      if (window.lastFailureAt < cutoff) {
        this.failures.delete(key);
      }
    }
    for (const [key, window] of this.totpFailures) {
      if (window.lastFailureAt < cutoff) {
        this.totpFailures.delete(key);
      }
    }
  }
}

/** Singleton tracker for the process lifetime. */
export const loginAttemptTracker = new LoginAttemptTracker();

// Periodic cleanup every 30 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => loginAttemptTracker.cleanup(), 30 * 60 * 1000);
}

/**
 * Check whether a timed account lock has expired and return how many
 * seconds remain, or 0 if the lock has expired/is not set.
 *
 * A lock set by brute-force protection (lockedBy === "brute_force") expires
 * after ACCOUNT_LOCKOUT_DURATION_MS. Admin-set locks (lockedBy is a user id or
 * null) never auto-expire and return Infinity.
 */
export function getRemainingLockSeconds(
  lockedAt: Date | null,
  lockedBy: string | null,
): number {
  if (!lockedAt) return 0;

  // Admin-imposed locks never auto-expire
  if (lockedBy !== "brute_force") return Infinity;

  const elapsed = Date.now() - lockedAt.getTime();
  const remaining = ACCOUNT_LOCKOUT_DURATION_MS - elapsed;
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}
