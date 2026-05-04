import { prisma } from "@/lib/prisma";

const AGGREGATE_PIPELINE_METRIC_FILTER = {
  componentId: null,
  nodeId: null,
} as const;

export type SliStatus = "healthy" | "degraded" | "no_data";

export interface SliResult {
  metric: string;
  status: "met" | "breached" | "no_data";
  value: number | null;
  threshold: number;
  condition: string;
}

export async function evaluatePipelineHealth(pipelineId: string): Promise<{
  status: SliStatus;
  slis: SliResult[];
}> {
  const sliDefs = await prisma.pipelineSli.findMany({
    where: { pipelineId, enabled: true },
  });

  if (sliDefs.length === 0) return { status: "no_data", slis: [] };

  const results: SliResult[] = [];

  for (const sli of sliDefs) {
    const since = new Date(Date.now() - sli.windowMinutes * 60_000);

    // Use aggregate to avoid transferring all metric rows to the application
    const agg = await prisma.pipelineMetric.aggregate({
      where: { pipelineId, ...AGGREGATE_PIPELINE_METRIC_FILTER, timestamp: { gte: since } },
      _sum: { eventsIn: true, errorsTotal: true, eventsDiscarded: true },
      _count: true,
    });

    if (agg._count === 0) {
      results.push({
        metric: sli.metric,
        status: "breached",
        value: 0,
        threshold: sli.threshold,
        condition: sli.condition,
      });
      continue;
    }

    let value: number;
    const totalEventsIn = Number(agg._sum.eventsIn ?? 0);

    // For rate-based metrics, zero throughput means no meaningful signal
    if (totalEventsIn === 0 && (sli.metric === "error_rate" || sli.metric === "discard_rate")) {
      results.push({
        metric: sli.metric,
        status: "no_data",
        value: null,
        threshold: sli.threshold,
        condition: sli.condition,
      });
      continue;
    }

    switch (sli.metric) {
      case "error_rate": {
        const totalErrors = Number(agg._sum.errorsTotal ?? 0);
        value = totalErrors / totalEventsIn;
        break;
      }
      case "discard_rate": {
        const totalDiscarded = Number(agg._sum.eventsDiscarded ?? 0);
        value = totalDiscarded / totalEventsIn;
        break;
      }
      case "throughput_floor": {
        const windowSeconds = sli.windowMinutes * 60;
        value = totalEventsIn / windowSeconds;
        break;
      }
      case "latency_mean": {
        const latencyAgg = await prisma.pipelineMetric.aggregate({
          where: {
            pipelineId,
            ...AGGREGATE_PIPELINE_METRIC_FILTER,
            timestamp: { gte: since },
            latencyMeanMs: { not: null },
          },
          _avg: { latencyMeanMs: true },
          _count: true,
        });
        if (latencyAgg._count === 0) {
          results.push({
            metric: sli.metric,
            status: "no_data",
            value: null,
            threshold: sli.threshold,
            condition: sli.condition,
          });
          continue;
        }
        value = latencyAgg._avg.latencyMeanMs ?? 0;
        break;
      }
      default:
        value = 0;
    }

    const met =
      sli.condition === "lt" ? value < sli.threshold : value > sli.threshold;
    results.push({
      metric: sli.metric,
      status: met ? "met" : "breached",
      value,
      threshold: sli.threshold,
      condition: sli.condition,
    });
  }

  const evaluated = results.filter((r) => r.status !== "no_data");
  const overallStatus: SliStatus =
    evaluated.length === 0
      ? "no_data"
      : evaluated.every((r) => r.status === "met")
        ? "healthy"
        : "degraded";
  return { status: overallStatus, slis: results };
}
