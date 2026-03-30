import { prisma } from "@/lib/prisma";
import { isTimescaleDbAvailable } from "@/server/services/timescaledb";

interface CleanupResultTimescale {
  method: "drop_chunks";
  tablesProcessed: number;
}

interface CleanupResultLegacy {
  method: "deleteMany";
  deletedRows: number;
}

export type CleanupResult = CleanupResultTimescale | CleanupResultLegacy;

/**
 * Delete metric/log rows older than the configured retention period.
 *
 * When TimescaleDB is available, uses `drop_chunks()` which is O(1) — it
 * deletes entire chunk files instead of scanning individual rows.
 *
 * When TimescaleDB is not available, falls back to Prisma `deleteMany()`
 * which performs a sequential row delete (slow at scale).
 */
export async function cleanupOldMetrics(): Promise<CleanupResult> {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: "singleton" },
    select: { metricsRetentionDays: true, logsRetentionDays: true },
  });

  const metricsRetentionDays = settings?.metricsRetentionDays ?? 7;
  const logsRetentionDays = settings?.logsRetentionDays ?? 3;

  if (isTimescaleDbAvailable()) {
    return cleanupWithDropChunks(metricsRetentionDays, logsRetentionDays);
  }

  return cleanupWithDeleteMany(metricsRetentionDays, logsRetentionDays);
}

/**
 * TimescaleDB path: drop entire chunks older than the retention window.
 * O(1) operation — deletes chunk files from disk.
 */
async function cleanupWithDropChunks(
  metricsRetentionDays: number,
  logsRetentionDays: number,
): Promise<CleanupResultTimescale> {
  const tables: Array<{ table: string; days: number }> = [
    { table: "PipelineMetric", days: metricsRetentionDays },
    { table: "NodeMetric", days: metricsRetentionDays },
    { table: "PipelineLog", days: logsRetentionDays },
    { table: "NodeStatusEvent", days: metricsRetentionDays },
  ];

  for (const { table, days } of tables) {
    await prisma.$queryRawUnsafe(
      `SELECT drop_chunks('"${table}"', older_than => INTERVAL '${days} days')`
    );
  }

  return { method: "drop_chunks", tablesProcessed: tables.length };
}

/**
 * Legacy PostgreSQL path: row-level deletes via Prisma.
 * Works on any PostgreSQL but is O(n) on row count.
 */
async function cleanupWithDeleteMany(
  metricsRetentionDays: number,
  logsRetentionDays: number,
): Promise<CleanupResultLegacy> {
  const metricsCutoff = new Date(
    Date.now() - metricsRetentionDays * 24 * 60 * 60 * 1000
  );
  const logsCutoff = new Date(
    Date.now() - logsRetentionDays * 24 * 60 * 60 * 1000
  );

  const [pipelineResult, nodeResult, logsResult, statusEventsResult] =
    await Promise.all([
      prisma.pipelineMetric.deleteMany({
        where: { timestamp: { lt: metricsCutoff } },
      }),
      prisma.nodeMetric.deleteMany({
        where: { timestamp: { lt: metricsCutoff } },
      }),
      prisma.pipelineLog.deleteMany({
        where: { timestamp: { lt: logsCutoff } },
      }),
      prisma.nodeStatusEvent.deleteMany({
        where: { timestamp: { lt: metricsCutoff } },
      }),
    ]);

  return {
    method: "deleteMany",
    deletedRows:
      pipelineResult.count +
      nodeResult.count +
      logsResult.count +
      statusEventsResult.count,
  };
}
