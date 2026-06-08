import { prisma } from "@/lib/prisma";
import type { PipelineSli } from "@/generated/prisma";

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

/** The subset of a `PipelineSli` row this evaluator reads. Accepting a
 *  structural shape (not the full Prisma model) keeps the function unit-
 *  testable with a plain fixture. */
export type SliDefinition = Pick<
  PipelineSli,
  "metric" | "threshold" | "condition" | "windowMinutes"
>;

/**
 * Evaluate a single SLI for a pipeline over an explicit time window.
 *
 * `until` omitted → open-ended window `[since, now)`, used by the rolling
 * health check. Both bounds set → a fixed `[since, until]` window, used by
 * replay validation to score a pipeline strictly over the events a replay
 * re-injected (so a healthy pipeline isn't dragged down — or propped up — by
 * traffic outside the replay).
 *
 * Returns `no_data` when the window holds no metric rows, or when a rate
 * metric (`error_rate` / `discard_rate`) has zero throughput — a ratio over
 * zero events carries no signal and must not be scored as a breach.
 */
export async function evaluateSliOverWindow(
  pipelineId: string,
  sli: SliDefinition,
  since: Date,
  until?: Date,
): Promise<SliResult> {
  const timestamp = until ? { gte: since, lte: until } : { gte: since };
  const noData: SliResult = {
    metric: sli.metric,
    status: "no_data",
    value: null,
    threshold: sli.threshold,
    condition: sli.condition,
  };

  // Use aggregate to avoid transferring all metric rows to the application
  const agg = await prisma.pipelineMetric.aggregate({
    where: { pipelineId, ...AGGREGATE_PIPELINE_METRIC_FILTER, timestamp },
    _sum: { eventsIn: true, errorsTotal: true, eventsDiscarded: true },
    _count: true,
  });

  if (agg._count === 0) return noData;

  let value: number;
  const totalEventsIn = Number(agg._sum.eventsIn ?? 0);

  // For rate-based metrics, zero throughput means no meaningful signal
  if (totalEventsIn === 0 && (sli.metric === "error_rate" || sli.metric === "discard_rate")) {
    return noData;
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
          timestamp,
          latencyMeanMs: { not: null },
        },
        _avg: { latencyMeanMs: true },
        _count: true,
      });
      if (latencyAgg._count === 0) return noData;
      value = latencyAgg._avg.latencyMeanMs ?? 0;
      break;
    }
    default:
      value = 0;
  }

  const met = sli.condition === "lt" ? value < sli.threshold : value > sli.threshold;
  return {
    metric: sli.metric,
    status: met ? "met" : "breached",
    value,
    threshold: sli.threshold,
    condition: sli.condition,
  };
}

/** Roll per-SLI results up to a single status: `no_data` when nothing scored,
 *  `healthy` when every scored SLI is met, `degraded` if any breached. */
export function rollUpSliStatus(results: SliResult[]): SliStatus {
  const evaluated = results.filter((r) => r.status !== "no_data");
  if (evaluated.length === 0) return "no_data";
  return evaluated.every((r) => r.status === "met") ? "healthy" : "degraded";
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
    // Each rolling SLI scores its own trailing window.
    const since = new Date(Date.now() - sli.windowMinutes * 60_000);
    results.push(await evaluateSliOverWindow(pipelineId, sli, since));
  }

  return { status: rollUpSliStatus(results), slis: results };
}
