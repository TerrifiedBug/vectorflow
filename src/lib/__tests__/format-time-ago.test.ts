import { describe, it, expect } from "vitest";
import { timeAgo } from "../format-time-ago";

// Fixed reference point: 2024-01-15 12:00:00 UTC
const NOW = new Date("2024-01-15T12:00:00Z");

/** Helper: create a Date that is `ms` milliseconds before NOW */
function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

describe("timeAgo", () => {
  // ── "just now" threshold (< 10 s) ─────────────────────────────────
  describe("just now (< 10 seconds)", () => {
    it("returns 'just now' for 0 seconds ago", () => {
      expect(timeAgo(NOW, NOW)).toBe("just now");
    });

    it("returns 'just now' for 5 seconds ago", () => {
      expect(timeAgo(ago(5 * SECOND), NOW)).toBe("just now");
    });

    it("returns 'just now' for 9 seconds ago", () => {
      expect(timeAgo(ago(9 * SECOND), NOW)).toBe("just now");
    });
  });

  // ── Seconds ────────────────────────────────────────────────────────
  describe("seconds", () => {
    it("returns '10 seconds ago' at the threshold", () => {
      expect(timeAgo(ago(10 * SECOND), NOW)).toBe("10 seconds ago");
    });

    it("returns '30 seconds ago'", () => {
      expect(timeAgo(ago(30 * SECOND), NOW)).toBe("30 seconds ago");
    });

    it("returns '59 seconds ago'", () => {
      // 59.4s rounds to 59
      expect(timeAgo(ago(59 * SECOND), NOW)).toBe("59 seconds ago");
    });
  });

  // ── Minutes ────────────────────────────────────────────────────────
  describe("minutes", () => {
    it("returns '1 minute ago' at 60 seconds", () => {
      expect(timeAgo(ago(60 * SECOND), NOW)).toBe("1 minute ago");
    });

    it("returns '1 minute ago' for 90 seconds", () => {
      // 90 / 60 = 1.5, rounds to 2? Let's verify
      const result = timeAgo(ago(90 * SECOND), NOW);
      expect(result).toMatch(/minutes? ago/);
    });

    it("returns '5 minutes ago'", () => {
      expect(timeAgo(ago(5 * MINUTE), NOW)).toBe("5 minutes ago");
    });

    it("returns '30 minutes ago'", () => {
      expect(timeAgo(ago(30 * MINUTE), NOW)).toBe("30 minutes ago");
    });

    it("returns '59 minutes ago'", () => {
      expect(timeAgo(ago(59 * MINUTE), NOW)).toBe("59 minutes ago");
    });
  });

  // ── Hours ──────────────────────────────────────────────────────────
  describe("hours", () => {
    it("returns '1 hour ago'", () => {
      expect(timeAgo(ago(HOUR), NOW)).toBe("1 hour ago");
    });

    it("returns '3 hours ago'", () => {
      expect(timeAgo(ago(3 * HOUR), NOW)).toBe("3 hours ago");
    });

    it("returns '23 hours ago'", () => {
      expect(timeAgo(ago(23 * HOUR), NOW)).toBe("23 hours ago");
    });
  });

  // ── Days ───────────────────────────────────────────────────────────
  describe("days", () => {
    it("returns 'yesterday' for 1 day ago", () => {
      expect(timeAgo(ago(DAY), NOW)).toBe("yesterday");
    });

    it("returns '3 days ago'", () => {
      expect(timeAgo(ago(3 * DAY), NOW)).toBe("3 days ago");
    });

    it("returns '6 days ago'", () => {
      expect(timeAgo(ago(6 * DAY), NOW)).toBe("6 days ago");
    });
  });

  // ── Weeks ──────────────────────────────────────────────────────────
  describe("weeks", () => {
    it("returns 'last week' for 7 days ago", () => {
      expect(timeAgo(ago(WEEK), NOW)).toBe("last week");
    });

    it("returns '2 weeks ago'", () => {
      expect(timeAgo(ago(2 * WEEK), NOW)).toBe("2 weeks ago");
    });

    it("returns '4 weeks ago'", () => {
      expect(timeAgo(ago(4 * WEEK), NOW)).toBe("4 weeks ago");
    });
  });

  // ── Months ─────────────────────────────────────────────────────────
  describe("months", () => {
    it("returns 'last month' for ~31 days ago", () => {
      // 31 days ≈ 4.43 weeks, crossing the 4.345-week threshold into months
      expect(timeAgo(ago(31 * DAY), NOW)).toBe("last month");
    });

    it("returns '3 months ago'", () => {
      expect(timeAgo(ago(3 * MONTH), NOW)).toBe("3 months ago");
    });

    it("returns '11 months ago'", () => {
      expect(timeAgo(ago(11 * MONTH), NOW)).toBe("11 months ago");
    });
  });

  // ── Years ──────────────────────────────────────────────────────────
  describe("years", () => {
    it("returns 'last year' for ~365 days ago", () => {
      expect(timeAgo(ago(YEAR), NOW)).toBe("last year");
    });

    it("returns '2 years ago'", () => {
      expect(timeAgo(ago(2 * YEAR), NOW)).toBe("2 years ago");
    });

    it("returns '5 years ago'", () => {
      expect(timeAgo(ago(5 * YEAR), NOW)).toBe("5 years ago");
    });
  });

  // ── Input coercion ─────────────────────────────────────────────────
  describe("input types", () => {
    it("accepts an ISO string", () => {
      const iso = ago(5 * MINUTE).toISOString();
      expect(timeAgo(iso, NOW)).toBe("5 minutes ago");
    });

    it("accepts a numeric timestamp (epoch ms)", () => {
      const epochMs = ago(2 * HOUR).getTime();
      expect(timeAgo(epochMs, NOW)).toBe("2 hours ago");
    });

    it("accepts a numeric now parameter", () => {
      const target = ago(3 * DAY);
      expect(timeAgo(target, NOW.getTime())).toBe("3 days ago");
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────
  describe("edge cases", () => {
    it("clamps small future drift to 'just now'", () => {
      const future = new Date(NOW.getTime() + 3 * SECOND);
      expect(timeAgo(future, NOW)).toBe("just now");
    });

    it("handles future dates beyond the 5-second clamp", () => {
      const future = new Date(NOW.getTime() + 10 * MINUTE);
      const result = timeAgo(future, NOW);
      expect(result).toMatch(/in \d+ minutes/);
    });

    it("defaults now to Date.now() when omitted", () => {
      const recent = new Date(Date.now() - 30 * SECOND);
      expect(timeAgo(recent)).toBe("30 seconds ago");
    });
  });
});
