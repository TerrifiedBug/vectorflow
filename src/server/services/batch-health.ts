import { prisma } from "@/lib/prisma";
import type { SliStatus, SliResult } from "@/server/services/sli-evaluator";

export interface BatchHealthResult {
  status: SliStatus;
  slis: SliResult[];
}

/**
 * Evaluate SLI health for many pipelines in bulk.
 *
 * Replaces N×evaluatePipelineHealth calls with at most 3 queries total:
 *   1. One findMany for all enabled SLIs across requested pipelines
 *   2. One groupBy for sum aggregates (eventsIn, errorsTotal, eventsDiscarded) per pipeline
 *   3. One groupBy for latency avg per pipeline (only if any SLI uses latency_mean)
 */
export async function batchEvaluatePipelineHealth(
  pipelineIds: string[],
): Promise<Record<string, BatchHealthResult>> {
  if (pipelineIds.length === 0) return {};

  // 1. Fetch ALL enabled SLIs across all requested pipelines in ONE query
  const allSlis = await prisma.pipelineSli.findMany({
    where: { pipelineId: { in: pipelineIds }, enabled: true },
  });

  // 2. Group SLIs by pipelineId
  const slisByPipeline = new Map<string, typeof allSlis>();
  for (const sli of allSlis) {
    const existing = slisByPipeline.get(sli.pipelineId);
    if (existing) {
      existing.push(sli);
    } else {
      slisByPipeline.set(sli.pipelineId, [sli]);
    }
  }

  // For pipelines with no SLIs, return no_data immediately
  const result: Record<string, BatchHealthResult> = {};
  for (const pid of pipelineIds) {
    if (!slisByPipeline.has(pid)) {
      result[pid] = { status: "no_data", slis: [] };
    }
  }

  // If no pipeline has SLIs, we're done
  const pipelineIdsWithSlis = [...slisByPipeline.keys()];
  if (pipelineIdsWithSlis.length === 0) return result;

  // 3. Find the max windowMinutes across all SLIs for the shared query window
  const maxWindow = Math.max(...allSlis.map((s) => s.windowMinutes));
  const since = new Date(Date.now() - maxWindow * 60_000);

  // 4. One groupBy for sum aggregates grouped by pipelineId
  const sumAggs = await prisma.pipelineMetric.groupBy({
    by: ["pipelineId"],
    where: {
      pipelineId: { in: pipelineIdsWithSlis },
      componentId: null,
      timestamp: { gte: since },
    },
    _sum: { eventsIn: true, errorsTotal: true, eventsDiscarded: true },
    _count: true,
  });

  const sumByPipeline = new Map(sumAggs.map((a) => [a.pipelineId, a]));

  // 5. One groupBy for latency avg grouped by pipelineId (only if any SLI uses latency_mean)
  const needsLatency = allSlis.some((s) => s.metric === "latency_mean");
  const latencyByPipeline = new Map<
    string,
    { _avg: { latencyMeanMs: number | null }; _count: number }
  >();

  if (needsLatency) {
    const latencyAggs = await prisma.pipelineMetric.groupBy({
      by: ["pipelineId"],
      where: {
        pipelineId: { in: pipelineIdsWithSlis },
        componentId: null,
        timestamp: { gte: since },
        latencyMeanMs: { not: null },
      },
      _avg: { latencyMeanMs: true },
      _count: true,
    });

    for (const la of latencyAggs) {
      latencyByPipeline.set(la.pipelineId, la);
    }
  }

  // 6. Compute per-pipeline SLI results using the same logic as evaluatePipelineHealth
  for (const [pipelineId, slis] of slisByPipeline) {
    const agg = sumByPipeline.get(pipelineId);
    const sliResults: SliResult[] = [];

    for (const sli of slis) {
      // No metric data at all for this pipeline
      if (!agg || agg._count === 0) {
        sliResults.push({
          metric: sli.metric,
          status: "breached",
          value: 0,
          threshold: sli.threshold,
          condition: sli.condition,
        });
        continue;
      }

      const totalEventsIn = Number(agg._sum.eventsIn ?? 0);

      // For rate-based metrics, zero throughput means no meaningful signal
      if (
        totalEventsIn === 0 &&
        (sli.metric === "error_rate" || sli.metric === "discard_rate")
      ) {
        sliResults.push({
          metric: sli.metric,
          status: "no_data",
          value: null,
          threshold: sli.threshold,
          condition: sli.condition,
        });
        continue;
      }

      let value: number;

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
          const la = latencyByPipeline.get(pipelineId);
          if (!la || la._count === 0) {
            sliResults.push({
              metric: sli.metric,
              status: "no_data",
              value: null,
              threshold: sli.threshold,
              condition: sli.condition,
            });
            continue;
          }
          value = la._avg.latencyMeanMs ?? 0;
          break;
        }
        default:
          value = 0;
      }

      const met =
        sli.condition === "lt" ? value < sli.threshold : value > sli.threshold;
      sliResults.push({
        metric: sli.metric,
        status: met ? "met" : "breached",
        value,
        threshold: sli.threshold,
        condition: sli.condition,
      });
    }

    const evaluated = sliResults.filter((r) => r.status !== "no_data");
    const overallStatus: SliStatus =
      evaluated.length === 0
        ? "no_data"
        : evaluated.every((r) => r.status === "met")
          ? "healthy"
          : "degraded";

    result[pipelineId] = { status: overallStatus, slis: sliResults };
  }

  return result;
}
