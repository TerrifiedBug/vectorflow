import { prisma } from "@/lib/prisma";

export type SliStatus = "healthy" | "degraded" | "no_data";

export interface SliResult {
  metric: string;
  status: "met" | "breached";
  value: number;
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
    const metrics = await prisma.pipelineMetric.findMany({
      where: { pipelineId, timestamp: { gte: since } },
    });

    if (metrics.length === 0) {
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
    const totalEventsIn = metrics.reduce(
      (s, m) => s + Number(m.eventsIn ?? 0),
      0,
    );

    switch (sli.metric) {
      case "error_rate": {
        const totalErrors = metrics.reduce(
          (s, m) => s + Number(m.errorsTotal ?? 0),
          0,
        );
        value = totalEventsIn > 0 ? totalErrors / totalEventsIn : 0;
        break;
      }
      case "discard_rate": {
        const totalDiscarded = metrics.reduce(
          (s, m) => s + Number(m.eventsDiscarded ?? 0),
          0,
        );
        value = totalEventsIn > 0 ? totalDiscarded / totalEventsIn : 0;
        break;
      }
      case "throughput_floor": {
        const windowSeconds = sli.windowMinutes * 60;
        value = totalEventsIn / windowSeconds;
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

  const overallStatus: SliStatus = results.every((r) => r.status === "met")
    ? "healthy"
    : "degraded";
  return { status: overallStatus, slis: results };
}
