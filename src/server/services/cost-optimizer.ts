import { prisma } from "@/lib/prisma";
import type {
  AnalysisResult,
  PipelineAggregates,
  SinkFingerprint,
  AnalysisThresholds,
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
 * Detect duplicate sinks -- pipelines that send data to the same destination.
 * Builds a fingerprint from sink component type + key config fields (host, endpoint, index).
 */
export async function detectDuplicateSinks(): Promise<AnalysisResult[]> {
  // Get all deployed pipeline sink nodes
  const sinkNodes = await prisma.pipelineNode.findMany({
    where: {
      kind: "SINK",
      pipeline: { isDraft: false, deployedAt: { not: null } },
    },
    select: {
      componentKey: true,
      componentType: true,
      config: true,
      pipeline: {
        select: {
          id: true,
          name: true,
          environmentId: true,
          environment: { select: { teamId: true } },
        },
      },
    },
  });

  // Build fingerprints from sink config
  const fingerprints: SinkFingerprint[] = sinkNodes
    .filter((n) => n.pipeline.environment.teamId)
    .map((node) => {
      const config = node.config as Record<string, unknown>;
      // Use common destination-identifying fields for fingerprint
      const destParts = [
        node.componentType,
        config.endpoint ?? config.host ?? config.address ?? "",
        config.index ?? config.bucket ?? config.topic ?? config.database ?? "",
      ];
      return {
        pipelineId: node.pipeline.id,
        pipelineName: node.pipeline.name,
        environmentId: node.pipeline.environmentId,
        teamId: node.pipeline.environment.teamId!,
        sinkComponentKey: node.componentKey,
        sinkComponentType: node.componentType,
        destinationFingerprint: destParts.join("::"),
      };
    });

  // Group by team + environment + fingerprint
  const groups = new Map<string, SinkFingerprint[]>();
  for (const fp of fingerprints) {
    const key = `${fp.teamId}::${fp.environmentId}::${fp.destinationFingerprint}`;
    const group = groups.get(key) ?? [];
    group.push(fp);
    groups.set(key, group);
  }

  const results: AnalysisResult[] = [];
  for (const [, group] of groups) {
    if (group.length < 2) continue;

    // Generate a recommendation for each duplicate beyond the first
    const primaryPipeline = group[0];
    for (const dup of group.slice(1)) {
      results.push({
        pipelineId: dup.pipelineId,
        pipelineName: dup.pipelineName,
        environmentId: dup.environmentId,
        teamId: dup.teamId,
        type: "DUPLICATE_SINK",
        title: `Pipeline "${dup.pipelineName}" has a duplicate sink`,
        description:
          `Sink "${dup.sinkComponentKey}" (${dup.sinkComponentType}) sends data to the same ` +
          `destination as "${primaryPipeline.sinkComponentKey}" in pipeline ` +
          `"${primaryPipeline.pipelineName}". Consider consolidating these pipelines ` +
          `to reduce duplicate writes.`,
        analysisData: {
          duplicateOf: primaryPipeline.pipelineId,
          duplicateOfName: primaryPipeline.pipelineName,
          sinkType: dup.sinkComponentType,
          sinkKey: dup.sinkComponentKey,
          destinationFingerprint: dup.destinationFingerprint,
        },
        estimatedSavingsBytes: null,
        suggestedAction: {
          type: "remove_sink",
          config: { sinkComponentKey: dup.sinkComponentKey },
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

  const [lowReduction, highError, duplicateSinks, stale] = await Promise.all([
    Promise.resolve(detectLowReduction(aggregates, thresholds)),
    Promise.resolve(detectHighErrorRate(aggregates, thresholds)),
    detectDuplicateSinks(),
    detectStalePipelines(aggregates, thresholds),
  ]);

  const allResults = [...lowReduction, ...highError, ...duplicateSinks, ...stale];
  debugLog(TAG, `Analysis complete: ${allResults.length} recommendations`, {
    lowReduction: lowReduction.length,
    highError: highError.length,
    duplicateSinks: duplicateSinks.length,
    stale: stale.length,
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
