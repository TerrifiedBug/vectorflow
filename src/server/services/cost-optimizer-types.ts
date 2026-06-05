import type { RecommendationType } from "@/generated/prisma";

/** Raw analysis result before AI enrichment */
export interface AnalysisResult {
  pipelineId: string;
  pipelineName: string;
  environmentId: string;
  teamId: string;
  type: RecommendationType;
  title: string;
  description: string;
  analysisData: Record<string, unknown>;
  estimatedSavingsBytes: bigint | null;
  suggestedAction: SuggestedAction | null;
}

export type SuggestedAction =
  | { type: "add_sampling"; config: { rate: number; componentKey: string } }
  | { type: "add_filter"; config: { condition: string; componentKey: string } }
  | { type: "drop_field"; config: { fields: string[]; componentKey: string } }
  | { type: "disable_pipeline"; config: Record<string, never> }
  | {
      type: "tail_sample";
      config: {
        componentKey: string;
        key: string;
        windowMs: number;
        keepPolicies: {
          onError: boolean;
          slowThresholdMs: number | null;
          baselinePercent: number;
        };
      };
    };

/** Per-field distinct-value cardinality over a sample of events. */
export interface FieldCardinality {
  field: string;
  /** Distinct stringified values observed for this field. */
  distinctCount: number;
  /** Number of sampled events the field appears in. */
  presentCount: number;
  /** distinctCount / presentCount, 0.0-1.0 (1.0 = every value unique). */
  ratio: number;
}

/** Pipeline metrics aggregated over the analysis window */
export interface PipelineAggregates {
  pipelineId: string;
  pipelineName: string;
  environmentId: string;
  teamId: string;
  totalBytesIn: bigint;
  totalBytesOut: bigint;
  totalEventsIn: bigint;
  totalEventsOut: bigint;
  totalErrors: bigint;
  totalDiscarded: bigint;
  /** Per-interval trace volume summed over the window (0 for log/metric pipelines). */
  totalSpansIn?: bigint;
  totalSpansOut?: bigint;
  totalTracesIn?: bigint;
  metricCount: number;
}

/** Thresholds for analysis (configurable) */
export interface AnalysisThresholds {
  /** Minimum bytes in over 24h to be considered "high volume" */
  minBytesIn: bigint;
  /** Maximum reduction ratio to flag as "low reduction" (0.0-1.0) */
  maxReductionRatio: number;
  /** Minimum error rate to flag (0.0-1.0) */
  minErrorRate: number;
  /** Maximum events in 24h to be considered "stale" */
  maxEventsForStale: bigint;
  /** Minimum days deployed to be considered for stale detection */
  minDaysDeployedForStale: number;
  /** Minimum (distinctValues / occurrences) ratio for a field to count as high-cardinality (0.0-1.0) */
  minCardinalityRatio: number;
  /** Minimum events a field must appear in before its cardinality is assessed */
  minCardinalitySamples: number;
  /** Minimum distinct values before a field is flagged (avoids flagging tiny samples) */
  minCardinalityDistinct: number;
  /** Minimum spans in 24h for a pipeline to be a tail-sampling candidate */
  minSpansForTailSample: bigint;
  /** Maximum error rate (errors/spans) for tail-sampling to be worthwhile (0.0-1.0) */
  maxTraceErrorRate: number;
  /** Minimum projected span-reduction percent before a tail-sample rec is emitted */
  minTailSampleReductionPercent: number;
}

export const DEFAULT_THRESHOLDS: AnalysisThresholds = {
  minBytesIn: BigInt(1_000_000_000), // 1 GB/day
  maxReductionRatio: 0.05,           // Less than 5% reduction
  minErrorRate: 0.10,                // More than 10% errors
  maxEventsForStale: BigInt(100),     // Fewer than 100 events/day
  minDaysDeployedForStale: 7,        // At least 7 days old
  minCardinalityRatio: 0.9,          // 90%+ of values unique
  minCardinalitySamples: 20,         // field must appear in >=20 sampled events
  minCardinalityDistinct: 20,        // and have >=20 distinct values
  minSpansForTailSample: BigInt(1_000_000), // 1M spans/day
  maxTraceErrorRate: 0.05,            // <5% of spans errored
  minTailSampleReductionPercent: 20,  // at least 20% projected drop
};
