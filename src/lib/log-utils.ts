// ── Log Line Parsing ─────────────────────────────────────────────────
// Client-safe utility for parsing raw log lines from agent heartbeats.
// Handles both structured JSON logs and plain-text formats.

export type ParsedLogEntry = {
  level: string; // "ERROR" | "WARN" | "INFO" | "DEBUG" | "TRACE"
  message: string;
  timestamp: number;
};

const LEVEL_ALIASES: Record<string, string> = {
  error: "ERROR",
  err: "ERROR",
  warn: "WARN",
  warning: "WARN",
  info: "INFO",
  debug: "DEBUG",
  trace: "TRACE",
};

/**
 * Regex matching common plain-text log level prefixes:
 * - `[ERROR]`, `[WARN]`, `[INFO]`, `[DEBUG]`, `[TRACE]`
 * - `ERROR:`, `WARN:`, etc.
 * - `error `, `warn `, etc. (case-insensitive, word boundary)
 */
const LEVEL_PREFIX_RE =
  /^\[?(error|err|warn|warning|info|debug|trace)\]?[:\s]/i;

/**
 * Parse a raw log line into a structured entry with level, message, and timestamp.
 *
 * Tries JSON first (structured logs from Vector/agents), falls back to
 * plain-text level prefix detection.
 *
 * @param raw - The raw log line string
 * @param fallbackTimestamp - Unix timestamp (ms) to use when the log doesn't contain one
 */
export function parseLogLine(
  raw: string,
  fallbackTimestamp: number,
): ParsedLogEntry {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { level: "INFO", message: "", timestamp: fallbackTimestamp };
  }

  // Try JSON structured log
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;

      const rawLevel =
        typeof parsed.level === "string" ? parsed.level : undefined;
      const level = rawLevel
        ? (LEVEL_ALIASES[rawLevel.toLowerCase()] ?? rawLevel.toUpperCase())
        : "INFO";

      const message =
        typeof parsed.msg === "string"
          ? parsed.msg
          : typeof parsed.message === "string"
            ? parsed.message
            : trimmed;

      const ts =
        typeof parsed.timestamp === "number"
          ? parsed.timestamp
          : typeof parsed.ts === "number"
            ? parsed.ts
            : fallbackTimestamp;

      return { level, message, timestamp: ts };
    } catch {
      // Not valid JSON — fall through to plain-text parsing
    }
  }

  // Plain-text level prefix detection
  const match = LEVEL_PREFIX_RE.exec(trimmed);
  if (match) {
    const level = LEVEL_ALIASES[match[1].toLowerCase()] ?? "INFO";
    const message = trimmed.slice(match[0].length).trim();
    return { level, message, timestamp: fallbackTimestamp };
  }

  // No level detected — default to INFO
  return { level: "INFO", message: trimmed, timestamp: fallbackTimestamp };
}
