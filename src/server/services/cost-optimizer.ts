import { prisma } from "@/lib/prisma";
import type {
  AnalysisResult,
  PipelineAggregates,
  AnalysisThresholds,
  FieldCardinality,
} from "@/server/services/cost-optimizer-types";
import { DEFAULT_THRESHOLDS } from "@/server/services/cost-optimizer-types";
import { debugLog } from "@/lib/logger";

const TAG = "cost-optimizer";

/**
 * Aggregate PipelineMetric rows for the given window into per-pipeline summaries.
 * Only considers aggregate rows (nodeId=null, componentId=null) to avoid double-counting.
 */
export async function aggregatePipelineMetrics(
  since: Date,
): Promise<PipelineAggregates[]> {
  const rows = await prisma.pipelineMetric.groupBy({
    by: ["pipelineId"],
    where: {
      nodeId: null,
      componentId: null,
      timestamp: { gte: since },
    },
    _sum: {
      bytesIn: true,
      bytesOut: true,
      eventsIn: true,
      eventsOut: true,
      errorsTotal: true,
      eventsDiscarded: true,
    },
    _count: { id: true },
  });

  // Fetch pipeline details in a single query
  const pipelineIds = rows.map((r) => r.pipelineId);
  const pipelines = await prisma.pipeline.findMany({
    where: { id: { in: pipelineIds }, isDraft: false, deployedAt: { not: null } },
    select: {
      id: true,
      name: true,
      environmentId: true,
      environment: { select: { teamId: true } },
    },
  });

  const pipelineMap = new Map(
    pipelines.map((p) => [p.id, p]),
  );

  return rows
    .filter((r) => pipelineMap.has(r.pipelineId))
    .map((r) => {
      const pipeline = pipelineMap.get(r.pipelineId)!;
      return {
        pipelineId: r.pipelineId,
        pipelineName: pipeline.name,
        environmentId: pipeline.environmentId,
        teamId: pipeline.environment.teamId ?? "",
        totalBytesIn: r._sum.bytesIn ?? BigInt(0),
        totalBytesOut: r._sum.bytesOut ?? BigInt(0),
        totalEventsIn: r._sum.eventsIn ?? BigInt(0),
        totalEventsOut: r._sum.eventsOut ?? BigInt(0),
        totalErrors: r._sum.errorsTotal ?? BigInt(0),
        totalDiscarded: r._sum.eventsDiscarded ?? BigInt(0),
        metricCount: r._count.id,
      };
    })
    .filter((a) => a.teamId !== "");
}

/**
 * Detect pipelines with high volume but low reduction ratio.
 * These pass most data through untouched -- a filter or sampling transform could help.
 */
export function detectLowReduction(
  aggregates: readonly PipelineAggregates[],
  thresholds: AnalysisThresholds = DEFAULT_THRESHOLDS,
  sinkKeyMap: Map<string, string> = new Map(),
): AnalysisResult[] {
  const results: AnalysisResult[] = [];

  for (const agg of aggregates) {
    if (agg.totalBytesIn < thresholds.minBytesIn) continue;
    if (agg.totalBytesIn === BigInt(0)) continue;

    const reductionRatio =
      1 - Number(agg.totalBytesOut) / Number(agg.totalBytesIn);

    if (reductionRatio < thresholds.maxReductionRatio) {
      const estimatedSavings =
        (agg.totalBytesIn * BigInt(20)) / BigInt(100); // assume 20% could be filtered

      results.push({
        pipelineId: agg.pipelineId,
        pipelineName: agg.pipelineName,
        environmentId: agg.environmentId,
        teamId: agg.teamId,
        type: "LOW_REDUCTION",
        title: `Pipeline "${agg.pipelineName}" has minimal data reduction`,
        description:
          `This pipeline processed ${formatBigIntBytes(agg.totalBytesIn)} in the last 24 hours ` +
          `but only reduced data volume by ${(reductionRatio * 100).toFixed(1)}%. ` +
          `Consider adding a filter or sampling transform to reduce unnecessary data.`,
        analysisData: {
          bytesIn: agg.totalBytesIn.toString(),
          bytesOut: agg.totalBytesOut.toString(),
          reductionRatio,
          eventsIn: agg.totalEventsIn.toString(),
          eventsOut: agg.totalEventsOut.toString(),
          targetSinkKey: sinkKeyMap.get(agg.pipelineId) ?? "",
        },
        estimatedSavingsBytes: estimatedSavings,
        suggestedAction: {
          type: "add_sampling",
          config: { rate: 0.8, componentKey: `sample_${agg.pipelineId.slice(0, 8)}` },
        },
      });
    }
  }

  return results;
}

/**
 * Detect pipelines with high error or discard rates.
 * Noisy sources that generate many errors waste compute and bandwidth.
 */
export function detectHighErrorRate(
  aggregates: readonly PipelineAggregates[],
  thresholds: AnalysisThresholds = DEFAULT_THRESHOLDS,
  sinkKeyMap: Map<string, string> = new Map(),
): AnalysisResult[] {
  const results: AnalysisResult[] = [];

  for (const agg of aggregates) {
    if (agg.totalEventsIn === BigInt(0)) continue;

    const errorRate =
      Number(agg.totalErrors + agg.totalDiscarded) / Number(agg.totalEventsIn);

    if (errorRate >= thresholds.minErrorRate) {
      results.push({
        pipelineId: agg.pipelineId,
        pipelineName: agg.pipelineName,
        environmentId: agg.environmentId,
        teamId: agg.teamId,
        type: "HIGH_ERROR_RATE",
        title: `Pipeline "${agg.pipelineName}" has a high error/discard rate`,
        description:
          `${(errorRate * 100).toFixed(1)}% of events are errors or discards ` +
          `(${agg.totalErrors.toString()} errors, ${agg.totalDiscarded.toString()} discarded ` +
          `out of ${agg.totalEventsIn.toString()} events). Review source configuration ` +
          `or add a pre-filter to drop known-bad events.`,
        analysisData: {
          eventsIn: agg.totalEventsIn.toString(),
          errors: agg.totalErrors.toString(),
          discarded: agg.totalDiscarded.toString(),
          errorRate,
          targetSinkKey: sinkKeyMap.get(agg.pipelineId) ?? "",
        },
        estimatedSavingsBytes:
          (agg.totalBytesIn * BigInt(Math.round(errorRate * 100))) / BigInt(100),
        suggestedAction: {
          type: "add_filter",
          config: {
            condition: ".level != \"error\" && !is_nullish(.message)",
            componentKey: `error_filter_${agg.pipelineId.slice(0, 8)}`,
          },
        },
      });
    }
  }

  return results;
}

/**
 * Detect stale pipelines -- deployed but processing almost no data.
 * These consume resources (agent processes, monitoring) for minimal value.
 */
export async function detectStalePipelines(
  aggregates: readonly PipelineAggregates[],
  thresholds: AnalysisThresholds = DEFAULT_THRESHOLDS,
): Promise<AnalysisResult[]> {
  const results: AnalysisResult[] = [];

  const staleCutoff = new Date(
    Date.now() - thresholds.minDaysDeployedForStale * 24 * 60 * 60 * 1000,
  );

  // Get deployment dates for pipelines with low throughput
  const lowThroughputIds = aggregates
    .filter((a) => a.totalEventsIn <= thresholds.maxEventsForStale)
    .map((a) => a.pipelineId);

  if (lowThroughputIds.length === 0) return results;

  const pipelines = await prisma.pipeline.findMany({
    where: {
      id: { in: lowThroughputIds },
      deployedAt: { lt: staleCutoff },
    },
    select: { id: true, name: true, deployedAt: true },
  });

  const pipelineDeployMap = new Map(
    pipelines.map((p) => [p.id, p]),
  );

  for (const agg of aggregates) {
    if (agg.totalEventsIn > thresholds.maxEventsForStale) continue;
    const pipeline = pipelineDeployMap.get(agg.pipelineId);
    if (!pipeline || !pipeline.deployedAt) continue;

    const daysSinceDeployed = Math.floor(
      (Date.now() - pipeline.deployedAt.getTime()) / (24 * 60 * 60 * 1000),
    );

    results.push({
      pipelineId: agg.pipelineId,
      pipelineName: agg.pipelineName,
      environmentId: agg.environmentId,
      teamId: agg.teamId,
      type: "STALE_PIPELINE",
      title: `Pipeline "${agg.pipelineName}" appears stale`,
      description:
        `This pipeline has been deployed for ${daysSinceDeployed} days but processed only ` +
        `${agg.totalEventsIn.toString()} events in the last 24 hours. ` +
        `Consider disabling or removing it to free up agent resources.`,
      analysisData: {
        eventsIn: agg.totalEventsIn.toString(),
        daysSinceDeployed,
        deployedAt: pipeline.deployedAt.toISOString(),
      },
      estimatedSavingsBytes: null,
      suggestedAction: { type: "disable_pipeline", config: {} },
    });
  }

  return results;
}

/**
 * Fetch the most recent sampled events for a pipeline, preferring a persisted
 * `TapCapture` (named, retained) and falling back to the latest successful
 * `EventSample`. Returns `[]` when neither exists — callers MUST skip cleanly
 * rather than fabricate events.
 */
export async function fetchRecentPipelineEvents(
  pipelineId: string,
): Promise<unknown[]> {
  const capture = await prisma.tapCapture.findFirst({
    where: { pipelineId },
    orderBy: { createdAt: "desc" },
    select: { events: true },
  });
  if (capture && Array.isArray(capture.events) && capture.events.length > 0) {
    return capture.events as unknown[];
  }

  const sample = await prisma.eventSample.findFirst({
    where: { pipelineId, error: null },
    orderBy: { sampledAt: "desc" },
    select: { events: true },
  });
  if (sample && Array.isArray(sample.events) && sample.events.length > 0) {
    return sample.events as unknown[];
  }

  return [];
}

/** Stable string key for distinct-value counting (objects/arrays included). */
function cardinalityKey(value: unknown): string {
  if (value === undefined) return "\u0000undefined";
  try {
    return JSON.stringify(value) ?? "\u0000null";
  } catch {
    return String(value);
  }
}

/** Cap distinct-value tracking per field so a pathological sample can't OOM. */
const MAX_DISTINCT_TRACKED = 50_000;

/**
 * Compute per-top-level-field distinct-value cardinality over a sample of
 * events and return only the fields that clear the high-cardinality thresholds
 * (near-unique values across enough occurrences), sorted by ratio then count.
 * Pure — no I/O.
 */
export function analyzeCardinality(
  events: readonly unknown[],
  thresholds: AnalysisThresholds = DEFAULT_THRESHOLDS,
): FieldCardinality[] {
  const present = new Map<string, number>();
  const distinct = new Map<string, Set<string>>();

  for (const ev of events) {
    if (!ev || typeof ev !== "object" || Array.isArray(ev)) continue;
    for (const [field, value] of Object.entries(ev as Record<string, unknown>)) {
      present.set(field, (present.get(field) ?? 0) + 1);
      let set = distinct.get(field);
      if (!set) {
        set = new Set<string>();
        distinct.set(field, set);
      }
      if (set.size < MAX_DISTINCT_TRACKED) set.add(cardinalityKey(value));
    }
  }

  const results: FieldCardinality[] = [];
  for (const [field, presentCount] of present) {
    if (presentCount < thresholds.minCardinalitySamples) continue;
    const distinctCount = distinct.get(field)?.size ?? 0;
    if (distinctCount < thresholds.minCardinalityDistinct) continue;
    const ratio = presentCount > 0 ? distinctCount / presentCount : 0;
    if (ratio >= thresholds.minCardinalityRatio) {
      results.push({
        field,
        distinctCount,
        presentCount,
        ratio: Math.round(ratio * 10000) / 10000,
      });
    }
  }

  return results.sort(
    (a, b) => b.ratio - a.ratio || b.distinctCount - a.distinctCount,
  );
}

/**
 * Estimate the fraction of total serialized bytes attributable to `fields`
 * across the sample (key + value JSON size / whole-event JSON size). Used to
 * project byte savings from dropping the offending fields.
 */
function estimateFieldByteFraction(
  events: readonly unknown[],
  fields: readonly string[],
): number {
  const fieldSet = new Set(fields);
  let total = 0;
  let dropped = 0;
  for (const ev of events) {
    const serialized = (() => {
      try {
        return JSON.stringify(ev) ?? "";
      } catch {
        return "";
      }
    })();
    total += serialized.length;
    if (ev && typeof ev === "object" && !Array.isArray(ev)) {
      for (const [field, value] of Object.entries(ev as Record<string, unknown>)) {
        if (!fieldSet.has(field)) continue;
        const valueLen = (() => {
          try {
            return (JSON.stringify(value ?? null) ?? "null").length;
          } catch {
            return 0;
          }
        })();
        // value + "key": + surrounding quotes/comma (~4 bytes)
        dropped += valueLen + field.length + 4;
      }
    }
  }
  return total > 0 ? Math.min(1, dropped / total) : 0;
}

/**
 * Detect high-cardinality fields on high-volume pipelines. For each high-volume
 * pipeline with a recent event sample, flag near-unique fields and propose
 * dropping them. Pipelines without an event sample are skipped cleanly (no
 * fabricated analysis).
 */
export async function detectHighCardinality(
  aggregates: readonly PipelineAggregates[],
  thresholds: AnalysisThresholds = DEFAULT_THRESHOLDS,
  sinkKeyMap: Map<string, string> = new Map(),
): Promise<AnalysisResult[]> {
  const results: AnalysisResult[] = [];

  for (const agg of aggregates) {
    // Only assess high-volume pipelines — a near-unique field on a trickle of
    // data is not worth a recommendation.
    if (agg.totalBytesIn < thresholds.minBytesIn) continue;

    const events = await fetchRecentPipelineEvents(agg.pipelineId);
    if (events.length < thresholds.minCardinalitySamples) continue;

    const offenders = analyzeCardinality(events, thresholds);
    if (offenders.length === 0) continue;

    const fields = offenders.map((o) => o.field);
    const fraction = estimateFieldByteFraction(events, fields);
    const estimatedSavings = BigInt(
      Math.round(Number(agg.totalBytesIn) * fraction),
    );

    results.push({
      pipelineId: agg.pipelineId,
      pipelineName: agg.pipelineName,
      environmentId: agg.environmentId,
      teamId: agg.teamId,
      type: "HIGH_CARDINALITY",
      title: `Pipeline "${agg.pipelineName}" has high-cardinality field(s)`,
      description:
        `Sampled ${events.length} events and found ${offenders.length} near-unique ` +
        `high-cardinality field(s): ${fields.map((f) => `"${f}"`).join(", ")}. ` +
        `High-cardinality fields bloat index size and storage cost downstream. ` +
        `Consider dropping or aggregating them before the sink.`,
      analysisData: {
        sampleSize: events.length,
        fields: offenders.map((o) => ({
          field: o.field,
          distinctCount: o.distinctCount,
          presentCount: o.presentCount,
          ratio: o.ratio,
        })),
        estimatedByteFraction: fraction,
        bytesIn: agg.totalBytesIn.toString(),
        targetSinkKey: sinkKeyMap.get(agg.pipelineId) ?? "",
      },
      estimatedSavingsBytes: estimatedSavings,
      suggestedAction: {
        type: "drop_field",
        config: {
          fields,
          componentKey: `drop_hicard_${agg.pipelineId.slice(0, 8)}`,
        },
      },
    });
  }

  return results;
}

/**
 * Run the complete cost analysis pipeline.
 * Returns all recommendations found across all four dimensions.
 */
export async function runCostAnalysis(
  thresholds: AnalysisThresholds = DEFAULT_THRESHOLDS,
): Promise<AnalysisResult[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  debugLog(TAG, "Starting cost analysis", { since: since.toISOString() });

  const aggregates = await aggregatePipelineMetrics(since);
  debugLog(TAG, `Aggregated metrics for ${aggregates.length} pipelines`);

  // Fetch the first sink key for each pipeline (used by apply service to rewire inputs)
  const pipelineIds = aggregates.map((a) => a.pipelineId);
  const sinkNodes = pipelineIds.length > 0
    ? await prisma.pipelineNode.findMany({
        where: { pipelineId: { in: pipelineIds }, kind: "SINK" },
        select: { pipelineId: true, componentKey: true },
        orderBy: { componentKey: "asc" },
      })
    : [];

  const sinkKeyMap = new Map<string, string>();
  for (const node of sinkNodes) {
    if (!sinkKeyMap.has(node.pipelineId)) {
      sinkKeyMap.set(node.pipelineId, node.componentKey);
    }
  }

  const [lowReduction, highError, stale, cardinality] = await Promise.all([
    Promise.resolve(detectLowReduction(aggregates, thresholds, sinkKeyMap)),
    Promise.resolve(detectHighErrorRate(aggregates, thresholds, sinkKeyMap)),
    detectStalePipelines(aggregates, thresholds),
    detectHighCardinality(aggregates, thresholds, sinkKeyMap),
  ]);

  const allResults = [...lowReduction, ...highError, ...stale, ...cardinality];
  debugLog(TAG, `Analysis complete: ${allResults.length} recommendations`, {
    lowReduction: lowReduction.length,
    highError: highError.length,
    stale: stale.length,
    cardinality: cardinality.length,
  });

  return allResults;
}

/** Format BigInt bytes into human-readable string */
function formatBigIntBytes(bytes: bigint): string {
  const num = Number(bytes);
  if (num >= 1_000_000_000_000) return `${(num / 1_000_000_000_000).toFixed(1)} TB`;
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)} GB`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)} MB`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)} KB`;
  return `${num} B`;
}
