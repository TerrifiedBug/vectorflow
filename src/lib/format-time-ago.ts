const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.345, unit: "week" }, // avg weeks per month
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/**
 * Format a date as a human-readable relative time string.
 *
 * Returns phrases like "just now", "5 minutes ago", "2 hours ago",
 * "3 days ago", "2 weeks ago", "4 months ago", "1 year ago".
 *
 * @param date  The date to format (Date object, ISO string, or timestamp)
 * @param now   Optional reference time (defaults to `Date.now()`); accepts
 *              Date or epoch ms — makes the function deterministically testable.
 */
export function timeAgo(
  date: Date | string | number,
  now?: Date | number,
): string {
  const target = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const reference = now instanceof Date ? now.getTime() : (now ?? Date.now());

  let diffSeconds = (target - reference) / 1000;

  // Clamp tiny future drifts (< 5 s) to "just now" so clock skew doesn't
  // produce confusing "in 0 seconds" output.
  if (diffSeconds > 0 && diffSeconds < 5) {
    diffSeconds = 0;
  }

  // "just now" for anything within ±10 seconds
  if (Math.abs(diffSeconds) < 10) {
    return "just now";
  }

  for (const division of DIVISIONS) {
    if (Math.abs(diffSeconds) < division.amount) {
      return rtf.format(Math.round(diffSeconds), division.unit);
    }
    diffSeconds /= division.amount;
  }

  // Fallback — should never happen since the last division is Infinity
  return rtf.format(Math.round(diffSeconds), "year");
}
