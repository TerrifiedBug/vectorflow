const RANGE_MINUTES: Record<string, number> = {
  "1h": 60,
  "6h": 360,
  "1d": 1440,
  "7d": 10080,
  "30d": 43200,
};

/** Bucket size in milliseconds for a given time window in minutes. */
export function bucketMsForMinutes(minutes: number): number {
  if (minutes <= 5) return 15_000;
  if (minutes <= 15) return 30_000;
  if (minutes <= 60) return 2 * 60_000;
  if (minutes <= 360) return 5 * 60_000;
  if (minutes <= 1440) return 15 * 60_000;
  if (minutes <= 10080) return 60 * 60_000;
  return 4 * 60 * 60_000;
}

/** Convert a dashboard/fleet range string to minutes. */
export function rangeToMinutes(range: string): number {
  return RANGE_MINUTES[range] ?? 1440;
}
