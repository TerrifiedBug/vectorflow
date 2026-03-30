import { prisma } from "@/lib/prisma";

// ─── Configuration ──────────────────────────────────────────────────────────

export const ANOMALY_CONFIG = {
  /** Number of days of historical data to use for baseline computation */
  BASELINE_WINDOW_DAYS: 7,
  /** Number of standard deviations from the mean to trigger an anomaly */
  SIGMA_THRESHOLD: 3,
  /** Minimum number of data points required to compute a reliable baseline */
  MIN_BASELINE_POINTS: 24,
  /**
   * Minimum stddev floor as a percentage of the mean.
   * Prevents false positives when a metric is constant (stddev = 0).
   * A 5% floor means the metric must deviate by at least 5% of the mean
   * before it can exceed the sigma threshold.
   */
  MIN_STDDEV_FLOOR_PERCENT: 5,
  /** Interval between detection runs in milliseconds (60 seconds) */
  POLL_INTERVAL_MS: 60_000,
  /** Cooldown: don't create a new anomaly if one exists for the same pipeline+type within this window */
  DEDUP_WINDOW_HOURS: 4,
} as const;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MetricDataPoint {
  timestamp: Date;
  value: number;
}

export interface Baseline {
  mean: number;
  stddev: number;
  sampleCount: number;
}

export type AnomalyTypeName =
  | "throughput_drop"
  | "throughput_spike"
  | "error_rate_spike"
  | "latency_spike";

export type AnomalySeverityName = "info" | "warning" | "critical";

export interface AnomalyDetectionResult {
  pipelineId: string;
  anomalyType: AnomalyTypeName;
  severity: AnomalySeverityName;
  metricName: string;
  currentValue: number;
  baselineMean: number;
  baselineStddev: number;
  deviationFactor: number;
  message: string;
}

// ─── Metric-to-anomaly type mapping ─────────────────────────────────────────

interface MetricAnomalyMapping {
  spikeType: AnomalyTypeName;
  dropType: AnomalyTypeName | null;
}

const METRIC_ANOMALY_MAP: Record<string, MetricAnomalyMapping> = {
  eventsIn: {
    spikeType: "throughput_spike",
    dropType: "throughput_drop",
  },
  errorsTotal: {
    spikeType: "error_rate_spike",
    dropType: null, // error drops are good, not anomalies
  },
  latencyMeanMs: {
    spikeType: "latency_spike",
    dropType: null, // latency drops are good, not anomalies
  },
};

// ─── Core computation ───────────────────────────────────────────────────────

/**
 * Compute the mean and population standard deviation from a set of data points.
 * Returns null if the dataset is empty.
 */
export function computeBaseline(points: MetricDataPoint[]): Baseline | null {
  if (points.length === 0) return null;

  const values = points.map((p) => p.value);
  const n = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;

  if (n === 1) {
    return { mean, stddev: 0, sampleCount: 1 };
  }

  const squaredDiffs = values.reduce((sum, v) => sum + (v - mean) ** 2, 0);
  const stddev = Math.sqrt(squaredDiffs / n);

  return { mean, stddev, sampleCount: n };
}

/**
 * Determine anomaly severity based on how many standard deviations the
 * current value is from the baseline mean.
 */
function classifySeverity(deviationFactor: number): AnomalySeverityName {
  if (deviationFactor >= 4) return "critical";
  if (deviationFactor >= 3) return "warning";
  return "info";
}

/**
 * Build a human-readable anomaly message.
 */
function buildAnomalyMessage(
  anomalyType: AnomalyTypeName,
  metricName: string,
  currentValue: number,
  mean: number,
  stddev: number,
  deviationFactor: number,
): string {
  const typeLabels: Record<AnomalyTypeName, string> = {
    throughput_drop: "Throughput drop",
    throughput_spike: "Throughput spike",
    error_rate_spike: "Error rate spike",
    latency_spike: "Latency spike",
  };

  const metricLabels: Record<string, string> = {
    eventsIn: "events/interval",
    errorsTotal: "errors/interval",
    latencyMeanMs: "ms",
  };

  const label = typeLabels[anomalyType];
  const unit = metricLabels[metricName] ?? metricName;

  return (
    `${label}: ${metricName} at ${currentValue.toFixed(1)} ${unit} ` +
    `(baseline: ${mean.toFixed(1)} +/- ${stddev.toFixed(1)}, ` +
    `${deviationFactor.toFixed(1)} sigma)`
  );
}

/**
 * Detect anomalies for a single metric on a single pipeline.
 *
 * Compares the current value against the baseline computed from historical data.
 * Returns an array of detected anomalies (0 or 1 elements for a single metric).
 */
export function detectAnomalies(
  pipelineId: string,
  metricName: string,
  currentValue: number,
  baselinePoints: MetricDataPoint[],
): AnomalyDetectionResult[] {
  const results: AnomalyDetectionResult[] = [];

  // Need sufficient historical data
  if (baselinePoints.length < ANOMALY_CONFIG.MIN_BASELINE_POINTS) {
    return results;
  }

  const baseline = computeBaseline(baselinePoints);
  if (!baseline) return results;

  const mapping = METRIC_ANOMALY_MAP[metricName];
  if (!mapping) return results;

  // Apply minimum stddev floor to avoid false positives on constant metrics.
  // Floor is MIN_STDDEV_FLOOR_PERCENT% of the mean, so a metric at 1000 needs
  // to deviate by at least 50 * SIGMA_THRESHOLD = 150 to trigger.
  const stddevFloor =
    Math.abs(baseline.mean) * (ANOMALY_CONFIG.MIN_STDDEV_FLOOR_PERCENT / 100);
  const effectiveStddev = Math.max(baseline.stddev, stddevFloor);

  // Prevent division by zero if mean is also zero
  if (effectiveStddev === 0) return results;

  const deviation = currentValue - baseline.mean;
  const deviationFactor = Math.abs(deviation) / effectiveStddev;

  if (deviationFactor < ANOMALY_CONFIG.SIGMA_THRESHOLD) {
    return results;
  }

  // Determine direction
  const isSpike = deviation > 0;
  const anomalyType = isSpike ? mapping.spikeType : mapping.dropType;

  // If there's no anomaly type for this direction (e.g. error drop), skip
  if (!anomalyType) return results;

  const severity = classifySeverity(deviationFactor);
  const message = buildAnomalyMessage(
    anomalyType,
    metricName,
    currentValue,
    baseline.mean,
    effectiveStddev,
    deviationFactor,
  );

  results.push({
    pipelineId,
    anomalyType,
    severity,
    metricName,
    currentValue,
    baselineMean: baseline.mean,
    baselineStddev: effectiveStddev,
    deviationFactor,
    message,
  });

  return results;
}

// ─── Data fetching ──────────────────────────────────────────────────────────

/** Metrics to evaluate for anomalies. */
const MONITORED_METRICS = ["eventsIn", "errorsTotal", "latencyMeanMs"] as const;

/**
 * Fetch the most recent aggregate metric row for a pipeline (componentId = null).
 * Returns the latest data point values keyed by metric name.
 */
async function fetchCurrentMetrics(
  pipelineId: string,
): Promise<Record<string, number> | null> {
  const latest = await prisma.pipelineMetric.findFirst({
    where: { pipelineId, componentId: null },
    orderBy: { timestamp: "desc" },
    select: {
      eventsIn: true,
      errorsTotal: true,
      latencyMeanMs: true,
    },
  });

  if (!latest) return null;

  return {
    eventsIn: Number(latest.eventsIn),
    errorsTotal: Number(latest.errorsTotal),
    latencyMeanMs: latest.latencyMeanMs ?? 0,
  };
}

/**
 * Fetch historical metric data for a pipeline over the baseline window.
 * Returns hourly data points for each monitored metric.
 */
async function fetchBaselineData(
  pipelineId: string,
): Promise<Record<string, MetricDataPoint[]>> {
  const windowStart = new Date(
    Date.now() - ANOMALY_CONFIG.BASELINE_WINDOW_DAYS * 24 * 3600_000,
  );

  const rows = await prisma.pipelineMetric.findMany({
    where: {
      pipelineId,
      componentId: null,
      timestamp: { gte: windowStart },
    },
    orderBy: { timestamp: "asc" },
    select: {
      timestamp: true,
      eventsIn: true,
      errorsTotal: true,
      latencyMeanMs: true,
    },
  });

  const result: Record<string, MetricDataPoint[]> = {
    eventsIn: [],
    errorsTotal: [],
    latencyMeanMs: [],
  };

  for (const row of rows) {
    result.eventsIn.push({
      timestamp: row.timestamp,
      value: Number(row.eventsIn),
    });
    result.errorsTotal.push({
      timestamp: row.timestamp,
      value: Number(row.errorsTotal),
    });
    result.latencyMeanMs.push({
      timestamp: row.timestamp,
      value: row.latencyMeanMs ?? 0,
    });
  }

  return result;
}

/**
 * Check if a duplicate anomaly already exists within the deduplication window.
 */
async function isDuplicate(
  pipelineId: string,
  anomalyType: string,
): Promise<boolean> {
  const windowStart = new Date(
    Date.now() - ANOMALY_CONFIG.DEDUP_WINDOW_HOURS * 3600_000,
  );

  const existing = await prisma.anomalyEvent.findFirst({
    where: {
      pipelineId,
      anomalyType: anomalyType as never,
      status: { in: ["open", "acknowledged"] },
      detectedAt: { gte: windowStart },
    },
  });

  return existing !== null;
}

// ─── Pipeline evaluation ────────────────────────────────────────────────────

/**
 * Evaluate a single pipeline for anomalies across all monitored metrics.
 * Persists any newly detected anomalies and returns them.
 */
export async function evaluatePipeline(
  pipeline: {
    id: string;
    environmentId: string;
    environment: { teamId: string | null };
  },
): Promise<AnomalyDetectionResult[]> {
  const current = await fetchCurrentMetrics(pipeline.id);
  if (!current) return [];

  const baseline = await fetchBaselineData(pipeline.id);
  const allResults: AnomalyDetectionResult[] = [];

  for (const metricName of MONITORED_METRICS) {
    const currentValue = current[metricName];
    if (currentValue === undefined || currentValue === null) continue;

    const baselinePoints = baseline[metricName] ?? [];
    const results = detectAnomalies(
      pipeline.id,
      metricName,
      currentValue,
      baselinePoints,
    );

    for (const result of results) {
      // Deduplicate: skip if a recent open anomaly exists for the same type
      const duplicate = await isDuplicate(pipeline.id, result.anomalyType);
      if (duplicate) continue;

      // Persist the anomaly event
      await prisma.anomalyEvent.create({
        data: {
          pipelineId: pipeline.id,
          environmentId: pipeline.environmentId,
          teamId: pipeline.environment.teamId ?? "",
          anomalyType: result.anomalyType as never,
          severity: result.severity as never,
          metricName: result.metricName,
          currentValue: result.currentValue,
          baselineMean: result.baselineMean,
          baselineStddev: result.baselineStddev,
          deviationFactor: result.deviationFactor,
          message: result.message,
          status: "open",
        },
      });

      allResults.push(result);
    }
  }

  return allResults;
}

/**
 * Evaluate all active (deployed, non-draft) pipelines for anomalies.
 * Called by the background job on the leader instance.
 */
export async function evaluateAllPipelines(): Promise<AnomalyDetectionResult[]> {
  const pipelines = await prisma.pipeline.findMany({
    where: {
      isDraft: false,
      deployedAt: { not: null },
    },
    select: {
      id: true,
      environmentId: true,
      environment: { select: { teamId: true } },
    },
  });

  const allResults: AnomalyDetectionResult[] = [];

  for (const pipeline of pipelines) {
    try {
      const results = await evaluatePipeline(pipeline);
      allResults.push(...results);
    } catch (err) {
      // Per-pipeline isolation: one failure must not stop others
      console.error(
        `[anomaly-detector] Error evaluating pipeline ${pipeline.id}:`,
        err,
      );
    }
  }

  if (allResults.length > 0) {
    console.log(
      `[anomaly-detector] Detected ${allResults.length} anomalies across ${pipelines.length} pipelines`,
    );
  }

  return allResults;
}
