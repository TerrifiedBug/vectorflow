import { prisma } from "@/lib/prisma";

const MAX_LINES = 5;
const MAX_MESSAGE_LENGTH = 300;
const DEFAULT_WINDOW_MINUTES = 10;

export interface ErrorContextLine {
  timestamp: string;
  message: string;
}

export interface ErrorContext {
  lines: ErrorContextLine[];
  truncated: boolean;
}

/**
 * Query recent ERROR-level pipeline logs for use as alert/anomaly context.
 * Returns null if no errors found. Errors are logged but never thrown —
 * alert creation must not fail because of a log query failure.
 */
export async function queryErrorContext(
  pipelineId: string,
  windowMinutes: number = DEFAULT_WINDOW_MINUTES,
): Promise<ErrorContext | null> {
  try {
    const windowStart = new Date(Date.now() - windowMinutes * 60_000);

    const logs = await prisma.pipelineLog.findMany({
      where: {
        pipelineId,
        level: "ERROR",
        timestamp: { gte: windowStart },
      },
      orderBy: { timestamp: "desc" },
      take: MAX_LINES + 1, // fetch one extra to detect truncation
      select: {
        timestamp: true,
        message: true,
      },
    });

    if (logs.length === 0) return null;

    const hasMoreThanMax = logs.length > MAX_LINES;
    const trimmedLogs = logs.slice(0, MAX_LINES);

    let anyMessageTruncated = false;

    const lines: ErrorContextLine[] = trimmedLogs.map((log) => {
      let message = log.message;
      if (message.length > MAX_MESSAGE_LENGTH) {
        message = message.slice(0, MAX_MESSAGE_LENGTH) + "...";
        anyMessageTruncated = true;
      }
      return {
        timestamp: log.timestamp.toISOString(),
        message,
      };
    });

    return {
      lines,
      truncated: hasMoreThanMax || anyMessageTruncated,
    };
  } catch (err) {
    console.error("[error-context] Failed to query error context:", err);
    return null;
  }
}
