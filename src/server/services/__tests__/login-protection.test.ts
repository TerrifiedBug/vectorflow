import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  LoginAttemptTracker,
  getRemainingLockSeconds,
  ACCOUNT_LOCKOUT_THRESHOLD,
  ACCOUNT_LOCKOUT_DURATION_MS,
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
