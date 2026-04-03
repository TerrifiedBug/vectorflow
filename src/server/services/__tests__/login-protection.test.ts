import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  LoginAttemptTracker,
  getRemainingLockSeconds,
  ACCOUNT_LOCKOUT_THRESHOLD,
  ACCOUNT_LOCKOUT_DURATION_MS,
  TOTP_RATE_LIMIT,
} from "../login-protection";

describe("LoginAttemptTracker", () => {
  let tracker: LoginAttemptTracker;

  beforeEach(() => {
    tracker = new LoginAttemptTracker();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts at 0 failures for unknown email", () => {
    expect(tracker.getFailureCount("user@example.com")).toBe(0);
  });

  it("increments failure count on recordFailure", () => {
    expect(tracker.recordFailure("user@example.com")).toBe(1);
    expect(tracker.recordFailure("user@example.com")).toBe(2);
    expect(tracker.getFailureCount("user@example.com")).toBe(2);
  });

  it("returns the new count from recordFailure", () => {
    for (let i = 1; i <= 5; i++) {
      expect(tracker.recordFailure("user@example.com")).toBe(i);
    }
  });

  it("clears failures after clearFailures", () => {
    tracker.recordFailure("user@example.com");
    tracker.recordFailure("user@example.com");
    tracker.clearFailures("user@example.com");
    expect(tracker.getFailureCount("user@example.com")).toBe(0);
  });

  it("normalizes email to lowercase", () => {
    tracker.recordFailure("User@Example.COM");
    expect(tracker.getFailureCount("user@example.com")).toBe(1);
    tracker.clearFailures("USER@EXAMPLE.COM");
    expect(tracker.getFailureCount("user@example.com")).toBe(0);
  });

  it("isolates counts between different emails", () => {
    tracker.recordFailure("alice@example.com");
    tracker.recordFailure("alice@example.com");
    tracker.recordFailure("bob@example.com");

    expect(tracker.getFailureCount("alice@example.com")).toBe(2);
    expect(tracker.getFailureCount("bob@example.com")).toBe(1);
  });

  it("returns ACCOUNT_LOCKOUT_THRESHOLD as the lock trigger count", () => {
    for (let i = 0; i < ACCOUNT_LOCKOUT_THRESHOLD - 1; i++) {
      tracker.recordFailure("user@example.com");
    }
    expect(tracker.getFailureCount("user@example.com")).toBe(ACCOUNT_LOCKOUT_THRESHOLD - 1);
    expect(tracker.recordFailure("user@example.com")).toBe(ACCOUNT_LOCKOUT_THRESHOLD);
  });

  it("cleans up stale entries older than maxAgeMs", () => {
    tracker.recordFailure("stale@example.com");
    vi.advanceTimersByTime(ACCOUNT_LOCKOUT_DURATION_MS + 1000);
    tracker.cleanup();
    expect(tracker.getFailureCount("stale@example.com")).toBe(0);
  });

  it("does not clean up recent entries", () => {
    tracker.recordFailure("fresh@example.com");
    vi.advanceTimersByTime(ACCOUNT_LOCKOUT_DURATION_MS - 1000);
    tracker.cleanup();
    expect(tracker.getFailureCount("fresh@example.com")).toBe(1);
  });
});

describe("LoginAttemptTracker — TOTP separate counter (regression: CVE fix)", () => {
  let tracker: LoginAttemptTracker;

  beforeEach(() => {
    tracker = new LoginAttemptTracker();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("TOTP failures do NOT increment the password failure counter", () => {
    tracker.recordTotpFailure("user@example.com");
    tracker.recordTotpFailure("user@example.com");
    expect(tracker.getFailureCount("user@example.com")).toBe(0);
    expect(tracker.getTotpFailureCount("user@example.com")).toBe(2);
  });

  it("password failures do NOT increment the TOTP failure counter", () => {
    tracker.recordFailure("user@example.com");
    tracker.recordFailure("user@example.com");
    expect(tracker.getTotpFailureCount("user@example.com")).toBe(0);
    expect(tracker.getFailureCount("user@example.com")).toBe(2);
  });

  it("mixed password + TOTP failures cannot trigger TOTP_RATE_LIMIT via the shared counter", () => {
    // Simulate TOTP_RATE_LIMIT - 1 password failures …
    for (let i = 0; i < TOTP_RATE_LIMIT - 1; i++) {
      tracker.recordFailure("user@example.com");
    }
    // … followed by 1 TOTP failure. The TOTP counter must still be 1, not TOTP_RATE_LIMIT.
    const totpFailures = tracker.recordTotpFailure("user@example.com");
    expect(totpFailures).toBe(1);
    expect(totpFailures).toBeLessThan(TOTP_RATE_LIMIT);
  });

  it("TOTP_RATE_LIMIT is only reached after TOTP_RATE_LIMIT TOTP-specific failures", () => {
    for (let i = 1; i <= TOTP_RATE_LIMIT; i++) {
      const count = tracker.recordTotpFailure("user@example.com");
      if (i < TOTP_RATE_LIMIT) {
        expect(count).toBeLessThan(TOTP_RATE_LIMIT);
      } else {
        expect(count).toBe(TOTP_RATE_LIMIT);
      }
    }
  });

  it("clearTotpFailures resets only the TOTP counter, not the password counter", () => {
    tracker.recordFailure("user@example.com");
    tracker.recordTotpFailure("user@example.com");
    tracker.clearTotpFailures("user@example.com");
    expect(tracker.getTotpFailureCount("user@example.com")).toBe(0);
    expect(tracker.getFailureCount("user@example.com")).toBe(1);
  });

  it("clearFailures resets only the password counter, not the TOTP counter", () => {
    tracker.recordFailure("user@example.com");
    tracker.recordTotpFailure("user@example.com");
    tracker.clearFailures("user@example.com");
    expect(tracker.getFailureCount("user@example.com")).toBe(0);
    expect(tracker.getTotpFailureCount("user@example.com")).toBe(1);
  });

  it("cleanup purges stale TOTP entries too", () => {
    tracker.recordTotpFailure("user@example.com");
    vi.advanceTimersByTime(ACCOUNT_LOCKOUT_DURATION_MS + 1000);
    tracker.cleanup();
    expect(tracker.getTotpFailureCount("user@example.com")).toBe(0);
  });

  it("normalizes TOTP identifier to lowercase", () => {
    tracker.recordTotpFailure("User@Example.COM");
    expect(tracker.getTotpFailureCount("user@example.com")).toBe(1);
    tracker.clearTotpFailures("USER@EXAMPLE.COM");
    expect(tracker.getTotpFailureCount("user@example.com")).toBe(0);
  });
});

describe("getRemainingLockSeconds — Infinity serialization (regression: audit log fix)", () => {
  it("returns Infinity for admin locks, which must be guarded before JSON serialization", () => {
    const lockedAt = new Date();
    const remaining = getRemainingLockSeconds(lockedAt, null);
    expect(remaining).toBe(Infinity);
    // Infinity is not JSON-safe — callers must use Number.isFinite() guard
    expect(Number.isFinite(remaining)).toBe(false);
    expect(JSON.parse(JSON.stringify({ remainingSeconds: remaining }))).toStrictEqual({
      remainingSeconds: null,
    });
  });

  it("returns a finite number for brute_force locks, safe to serialize", () => {
    const lockedAt = new Date();
    const remaining = getRemainingLockSeconds(lockedAt, "brute_force");
    expect(Number.isFinite(remaining)).toBe(true);
    const serialized = JSON.parse(JSON.stringify({ remainingSeconds: remaining }));
    expect(typeof serialized.remainingSeconds).toBe("number");
  });
});

describe("getRemainingLockSeconds", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0 when lockedAt is null", () => {
    expect(getRemainingLockSeconds(null, null)).toBe(0);
    expect(getRemainingLockSeconds(null, "brute_force")).toBe(0);
  });

  it("returns Infinity for admin-imposed locks (lockedBy is a userId)", () => {
    const lockedAt = new Date();
    expect(getRemainingLockSeconds(lockedAt, "some-user-id")).toBe(Infinity);
    expect(getRemainingLockSeconds(lockedAt, null)).toBe(Infinity);
  });

  it("returns positive seconds for a fresh brute_force lock", () => {
    const lockedAt = new Date();
    const remaining = getRemainingLockSeconds(lockedAt, "brute_force");
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(ACCOUNT_LOCKOUT_DURATION_MS / 1000);
  });

  it("returns 0 when brute_force lock has expired", () => {
    const lockedAt = new Date();
    vi.advanceTimersByTime(ACCOUNT_LOCKOUT_DURATION_MS + 1000);
    expect(getRemainingLockSeconds(lockedAt, "brute_force")).toBe(0);
  });

  it("returns remaining seconds accurately mid-lockout", () => {
    const lockedAt = new Date();
    const halfDuration = ACCOUNT_LOCKOUT_DURATION_MS / 2;
    vi.advanceTimersByTime(halfDuration);
    const remaining = getRemainingLockSeconds(lockedAt, "brute_force");
    // Should be approximately half the duration remaining
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(halfDuration / 1000 + 1);
  });

  it("returns exactly 1 second before expiry", () => {
    const lockedAt = new Date();
    vi.advanceTimersByTime(ACCOUNT_LOCKOUT_DURATION_MS - 1000);
    const remaining = getRemainingLockSeconds(lockedAt, "brute_force");
    expect(remaining).toBeGreaterThanOrEqual(1);
  });
});
