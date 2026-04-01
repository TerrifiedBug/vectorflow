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
  | { type: "disable_pipeline"; config: Record<string, never> };

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
}

export const DEFAULT_THRESHOLDS: AnalysisThresholds = {
  minBytesIn: BigInt(1_000_000_000), // 1 GB/day
  maxReductionRatio: 0.05,           // Less than 5% reduction
  minErrorRate: 0.10,                // More than 10% errors
  maxEventsForStale: BigInt(100),     // Fewer than 100 events/day
  minDaysDeployedForStale: 7,        // At least 7 days old
};
