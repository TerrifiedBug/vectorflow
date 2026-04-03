/**
 * Login brute-force protection.
 *
 * Tracks failed login attempts per account (email) in memory. When the failure
 * threshold is reached, the caller is responsible for writing lockedAt to the DB.
 * On successful login, the caller clears the in-memory counter.
 *
 * Single-instance mode: in-memory only (counters reset on restart, but DB
 * lockedAt persists across restarts).
 * HA mode: callers should also check DB lockedAt which persists across nodes.
 */

export const ACCOUNT_LOCKOUT_THRESHOLD = 10; // failed attempts before lock
export const ACCOUNT_LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
export const TOTP_RATE_LIMIT = 5; // TOTP attempts per window
export const TOTP_RATE_WINDOW_MS = 5 * 60 * 1000; // 5-minute window

interface FailureWindow {
  count: number;
  lastFailureAt: number;
}

export class LoginAttemptTracker {
  private readonly failures = new Map<string, FailureWindow>();

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
