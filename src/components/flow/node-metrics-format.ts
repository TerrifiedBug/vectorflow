/**
 * Format an events-per-second rate for display on flow nodes.
 */
export function formatRate(rate: number | undefined | null): string {
  if (rate == null || rate === 0) return "0";
  if (rate >= 1_000_000) return `${(rate / 1_000_000).toFixed(1)}M`;
  if (rate >= 1_000) return `${(rate / 1_000).toFixed(1)}K`;
  return rate.toFixed(0);
}

/**
 * Format a bytes-per-second rate for display on flow nodes.
 */
export function formatBytesRate(rate: number | undefined | null): string {
  if (rate == null || rate === 0) return "0 B/s";
  if (rate >= 1_073_741_824) return `${(rate / 1_073_741_824).toFixed(1)} GB/s`;
  if (rate >= 1_048_576) return `${(rate / 1_048_576).toFixed(1)} MB/s`;
  if (rate >= 1_024) return `${(rate / 1_024).toFixed(1)} KB/s`;
  return `${rate.toFixed(0)} B/s`;
}
