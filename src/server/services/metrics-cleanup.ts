import { prisma } from "@/lib/prisma";

/**
 * Delete PipelineMetric and NodeMetric rows older than the configured retention period.
 * Returns the total count of deleted rows.
 */
export async function cleanupOldMetrics(): Promise<number> {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: "singleton" },
    select: { metricsRetentionDays: true, logsRetentionDays: true },
  });

  const metricsRetentionDays = settings?.metricsRetentionDays ?? 7;
  const logsRetentionDays = settings?.logsRetentionDays ?? 3;

  const metricsCutoff = new Date(Date.now() - metricsRetentionDays * 24 * 60 * 60 * 1000);
  const logsCutoff = new Date(Date.now() - logsRetentionDays * 24 * 60 * 60 * 1000);

  const [pipelineResult, nodeResult, logsResult] = await Promise.all([
    prisma.pipelineMetric.deleteMany({
      where: { timestamp: { lt: metricsCutoff } },
    }),
    prisma.nodeMetric.deleteMany({
      where: { timestamp: { lt: metricsCutoff } },
    }),
    prisma.pipelineLog.deleteMany({
      where: { timestamp: { lt: logsCutoff } },
    }),
  ]);

  return pipelineResult.count + nodeResult.count + logsResult.count;
}
