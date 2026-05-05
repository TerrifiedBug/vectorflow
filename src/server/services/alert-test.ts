/**
 * Pure helpers for the alertRules.testRule live preview.
 *
 * Deliberately Prisma-free so the breach-walking logic is trivially unit
 * testable. The router calls queryPipelineMetricsAggregated to fetch the
 * PipelineMetricRow series, then hands those rows here for projection +
 * breach detection.
 */
import type { AlertCondition, AlertMetric } from "@/generated/prisma";
import type { PipelineMetricRow } from "@/server/services/metrics-query";
import { checkCondition } from "@/server/services/alert-evaluator";

export interface PreviewPoint {
  ts: number;
  value: number;
}

export interface BreachWindow {
  start: number;
  end: number;
}

export interface EvaluateRuleHistoryInput {
  rows: PipelineMetricRow[];
  metric: AlertMetric;
  condition: AlertCondition;
  threshold: number;
  durationSeconds: number;
}

export interface EvaluateRuleHistoryResult {
  series: PreviewPoint[];
  breaches: BreachWindow[];
  wouldHaveFired: number;
}

/**
 * Project a PipelineMetricRow into a numeric value for the given metric.
 * Returns null for metrics that cannot be derived from PipelineMetricRow.
 */
export function metricToColumn(
  metric: AlertMetric,
  row: PipelineMetricRow,
): number | null {
  switch (metric) {
    case "error_rate": {
      const inn = Number(row.eventsIn);
      if (inn <= 0) return 0;
      return (Number(row.errorsTotal) / inn) * 100;
    }
    case "discarded_rate": {
      const inn = Number(row.eventsIn);
      if (inn <= 0) return 0;
      return (Number(row.eventsDiscarded) / inn) * 100;
    }
    case "latency_mean":
      return row.latencyMeanMs ?? null;
    case "throughput_floor":
      // Events per bucket. Caller doesn't know bucket size; raw count is the
      // most honest value and matches FleetAlertService semantics.
      return Number(row.eventsOut);
    default:
      return null;
  }
}

/**
 * Metrics whose values can be projected from PipelineMetricRow and previewed
 * in the rule editor without a node selection.
 */
export const PIPELINE_PREVIEW_METRICS: ReadonlySet<AlertMetric> = new Set<AlertMetric>([
  "error_rate",
  "discarded_rate",
  "latency_mean",
  "throughput_floor",
]);

/**
 * Reasons a metric cannot be previewed by testRule. Returned to the UI as a
 * friendly string when `supported: false`.
 */
export function unsupportedPreviewReason(metric: AlertMetric): string | null {
  if (PIPELINE_PREVIEW_METRICS.has(metric)) return null;

  // Node-scoped threshold metrics
  if (
    metric === "cpu_usage" ||
    metric === "memory_usage" ||
    metric === "disk_usage" ||
    metric === "node_unreachable" ||
    metric === "pipeline_crashed"
  ) {
    return "Node-scoped metrics need a node selection — preview unsupported here.";
  }

  // Fleet aggregates
  if (
    metric === "fleet_error_rate" ||
    metric === "fleet_throughput_drop" ||
    metric === "fleet_event_volume" ||
    metric === "node_load_imbalance"
  ) {
    return "Fleet aggregates aren't available as a preview series yet.";
  }

  if (metric === "version_drift" || metric === "config_drift") {
    return "Drift metrics don't expose a historical time-series.";
  }

  if (metric === "log_keyword") {
    return "Keyword alerts fire inline on log ingest — no preview series.";
  }

  if (metric === "cost_threshold_exceeded") {
    return "Cost threshold is evaluated against the monthly budget, not a time-series.";
  }

  // Everything else is event-based
  return "This is an event-based metric — it fires on occurrence, no preview.";
}

/**
 * Walk a series of {ts, value} points and count how many times the rule
 * would have fired given the condition + threshold + sustained duration.
 *
 * Algorithm: accumulate consecutive breach buckets. Bucket "duration" is
 * derived from the gap to the previous bucket. A fire is recorded the first
 * bucket where total accumulated breach time >= durationSeconds. The breach
 * window spans firstBreachTs → fireTs. After firing we keep accumulating,
 * so a long unbroken breach still counts as a single fire (matching server
 * semantics where one event stays open until resolved).
 */
export function evaluateRuleHistory(
  input: EvaluateRuleHistoryInput,
): EvaluateRuleHistoryResult {
  const series: PreviewPoint[] = [];
  const breaches: BreachWindow[] = [];
  let runStart: number | null = null;
  let runAccumSeconds = 0;
  let runFired = false;
  let previousPointTs: number | null = null;

  for (const row of input.rows) {
    const v = metricToColumn(input.metric, row);
    if (v === null) {
      // Missing data breaks sustained breach runs. Do not collapse gaps.
      runStart = null;
      runAccumSeconds = 0;
      runFired = false;
      previousPointTs = null;
      continue;
    }

    const point = { ts: row.timestamp.getTime(), value: v };
    series.push(point);
    const breached = checkCondition(point.value, input.condition, input.threshold);

    if (breached) {
      if (runStart === null) {
        runStart = point.ts;
        runAccumSeconds = 0;
        runFired = false;
      } else if (previousPointTs !== null) {
        runAccumSeconds += Math.max(0, (point.ts - previousPointTs) / 1000);
      }

      if (!runFired && runAccumSeconds >= input.durationSeconds) {
        breaches.push({ start: runStart, end: point.ts });
        runFired = true;
      }
    } else {
      runStart = null;
      runAccumSeconds = 0;
      runFired = false;
    }

    previousPointTs = point.ts;
  }

  return {
    series,
    breaches,
    wouldHaveFired: breaches.length,
  };
}
