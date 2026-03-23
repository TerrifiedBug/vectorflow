export function formatCount(n: number | bigint | null): string {
  const v = Number(n ?? 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

export function formatBytes(n: number | bigint | null): string {
  const v = Number(n ?? 0);
  if (v >= 1_099_511_627_776) return `${(v / 1_099_511_627_776).toFixed(1)} TB`;
  if (v >= 1_073_741_824) return `${(v / 1_073_741_824).toFixed(1)} GB`;
  if (v >= 1_048_576) return `${(v / 1_048_576).toFixed(1)} MB`;
  if (v >= 1_024) return `${(v / 1_024).toFixed(1)} KB`;
  return `${v} B`;
}

export function formatRate(n: number | undefined | null): string {
  if (n == null || n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

export function formatBytesRate(n: number | undefined | null): string {
  if (n == null || n === 0) return "0 B/s";
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB/s`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB/s`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)} KB/s`;
  return `${Math.round(n)} B/s`;
}

export function formatEventsRate(n: number | undefined | null): string {
  if (n == null || n === 0) return "0 ev/s";
  return `${formatRate(n)} ev/s`;
}

export function formatPercent(v: number): string {
  return `${v.toFixed(1)}%`;
}

export function formatLastSeen(date: Date | string | null): string {
  if (!date) return "Never";
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return d.toLocaleDateString();
}

export function formatTimestamp(date: Date | string | null): string {
  if (!date) return "Never";
  const d = new Date(date);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** SI-suffix formatter for chart Y-axes: 1000 → "1K", 1500000 → "1.5M" */
export function formatSI(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n === 0) return "0";
  return n.toFixed(0);
}

/** Time axis formatter — adapts label density to range */
export function formatTimeAxis(timestamp: number | string, range: string): string {
  const d = new Date(Number(timestamp));
  if (range === "7d" || range === "30d") {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Format latency in milliseconds to a human-readable string. */
export function formatLatency(ms: number): string {
  if (ms === 0) return "0ms";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 1) return `${ms.toFixed(1)}ms`;
  if (ms >= 0.001) return `${(ms * 1000).toFixed(0)}us`;
  return `${ms.toFixed(3)}ms`;
}

/** Format a date/string to HH:MM (locale-aware, 2-digit hour and minute). */
export function formatTime(date: Date | string): string {
  return new Date(date).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format a date/string to HH:MM:SS (24-hour, no AM/PM). */
export function formatTimeWithSeconds(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
