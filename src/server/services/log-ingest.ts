import { prisma } from "@/lib/prisma";
import type { LogLevel } from "@/generated/prisma";

const VALID_LEVELS = new Set<LogLevel>(["TRACE", "DEBUG", "INFO", "WARN", "ERROR"]);

/**
 * Parse log level from a raw log line.
 * Tries JSON parse first (Vector outputs `{"level":"INFO",...}`),
 * then falls back to string matching.
 */
export function parseLogLevel(line: string): LogLevel {
  // Try JSON parse — Vector structured logs
  if (line.startsWith("{")) {
    try {
      const obj = JSON.parse(line);
      const lvl = (obj.level ?? obj.lvl ?? "").toUpperCase();
      if (VALID_LEVELS.has(lvl as LogLevel)) return lvl as LogLevel;
    } catch {
      // not JSON, fall through
    }
  }

  // Fallback: match common log patterns like "2024-01-01T00:00:00Z ERROR ..."
  const upper = line.toUpperCase();
  if (upper.includes("ERROR")) return "ERROR";
  if (upper.includes("WARN")) return "WARN";
  if (upper.includes("DEBUG")) return "DEBUG";
  if (upper.includes("TRACE")) return "TRACE";
  return "INFO";
}

/**
 * Persist pipeline log lines to the database.
 * Timestamps are staggered by 1ms to preserve ordering within a batch.
 */
export async function ingestLogs(
  nodeId: string,
  pipelineId: string,
  lines: string[],
): Promise<void> {
  if (lines.length === 0) return;

  const now = Date.now();
  const data = lines.map((line, i) => ({
    pipelineId,
    nodeId,
    timestamp: new Date(now + i), // 1ms stagger for ordering
    level: parseLogLevel(line),
    message: line,
  }));

  await prisma.pipelineLog.createMany({ data });
}
