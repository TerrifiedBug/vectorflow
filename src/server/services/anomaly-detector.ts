import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { queryErrorContext } from "@/server/services/error-context";

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
  /** Interval between detection runs in milliseconds (5 minutes) */
  POLL_INTERVAL_MS: 300_000,
  /** Cooldown: don't create a new anomaly if one exists for the same pipeline+type within this window */
  DEDUP_WINDOW_HOURS: 4,
} as const;

// ─── Runtime config (DB-backed with in-memory cache) ────────────────────────

export interface RuntimeAnomalyConfig {
  baselineWindowDays: number;
  sigmaThreshold: number;
  minBaselinePoints: number;
  minStddevFloorPercent: number;
  pollIntervalMs: number;
  dedupWindowHours: number;
  enabledMetrics: readonly string[];
}

let cachedConfig: RuntimeAnomalyConfig | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 1 minute — aligns with poll interval

/**
 * Load anomaly config from DB with 60-second in-memory cache.
 * Falls back to hardcoded ANOMALY_CONFIG defaults on DB failure.
 */
export async function getAnomalyConfig(): Promise<RuntimeAnomalyConfig> {
  const now = Date.now();
  if (cachedConfig && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedConfig;
  }

  try {
    const settings = await prisma.systemSettings.findUnique({
      where: { id: "singleton" },
      select: {
        anomalyBaselineWindowDays: true,
        anomalySigmaThreshold: true,
        anomalyMinStddevFloorPercent: true,
        anomalyDedupWindowHours: true,
        anomalyEnabledMetrics: true,
      },
    });

    cachedConfig = {
      baselineWindowDays: settings?.anomalyBaselineWindowDays ?? ANOMALY_CONFIG.BASELINE_WINDOW_DAYS,
      sigmaThreshold: settings?.anomalySigmaThreshold ?? ANOMALY_CONFIG.SIGMA_THRESHOLD,
      minBaselinePoints: ANOMALY_CONFIG.MIN_BASELINE_POINTS, // not user-configurable
      minStddevFloorPercent: settings?.anomalyMinStddevFloorPercent ?? ANOMALY_CONFIG.MIN_STDDEV_FLOOR_PERCENT,
      pollIntervalMs: ANOMALY_CONFIG.POLL_INTERVAL_MS, // not user-configurable
      dedupWindowHours: settings?.anomalyDedupWindowHours ?? ANOMALY_CONFIG.DEDUP_WINDOW_HOURS,
      enabledMetrics: settings?.anomalyEnabledMetrics
        ? settings.anomalyEnabledMetrics.split(",").map((s) => s.trim()).filter(Boolean)
        : ["eventsIn", "errorsTotal", "latencyMeanMs"],
    };
  } catch {
    // DB failure: fall back to hardcoded defaults
    cachedConfig = {
      baselineWindowDays: ANOMALY_CONFIG.BASELINE_WINDOW_DAYS,
      sigmaThreshold: ANOMALY_CONFIG.SIGMA_THRESHOLD,
      minBaselinePoints: ANOMALY_CONFIG.MIN_BASELINE_POINTS,
      minStddevFloorPercent: ANOMALY_CONFIG.MIN_STDDEV_FLOOR_PERCENT,
      pollIntervalMs: ANOMALY_CONFIG.POLL_INTERVAL_MS,
      dedupWindowHours: ANOMALY_CONFIG.DEDUP_WINDOW_HOURS,
      enabledMetrics: ["eventsIn", "errorsTotal", "latencyMeanMs"],
    };
  }

  cacheTimestamp = now;
  return cachedConfig;
}

/** Bust the in-memory cache so the next poll picks up fresh config. */
export function invalidateAnomalyConfigCache(): void {
  cachedConfig = null;
  cacheTimestamp = 0;
}

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
function classifySeverity(
  deviationFactor: number,
  sigmaThreshold: number,
): AnomalySeverityName {
  if (deviationFactor >= sigmaThreshold + 1) return "critical";
  if (deviationFactor >= sigmaThreshold) return "warning";
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
  config: RuntimeAnomalyConfig = {
    baselineWindowDays: ANOMALY_CONFIG.BASELINE_WINDOW_DAYS,
    sigmaThreshold: ANOMALY_CONFIG.SIGMA_THRESHOLD,
    minBaselinePoints: ANOMALY_CONFIG.MIN_BASELINE_POINTS,
    minStddevFloorPercent: ANOMALY_CONFIG.MIN_STDDEV_FLOOR_PERCENT,
    pollIntervalMs: ANOMALY_CONFIG.POLL_INTERVAL_MS,
    dedupWindowHours: ANOMALY_CONFIG.DEDUP_WINDOW_HOURS,
    enabledMetrics: ["eventsIn", "errorsTotal", "latencyMeanMs"],
  },
): AnomalyDetectionResult[] {
  const results: AnomalyDetectionResult[] = [];

  // Need sufficient historical data
  if (baselinePoints.length < config.minBaselinePoints) {
    return results;
  }

  const baseline = computeBaseline(baselinePoints);
  if (!baseline) return results;

  return detectAnomalyFromBaseline(pipelineId, metricName, currentValue, baseline, config);
}

/**
 * Core anomaly check against a precomputed Baseline object.
 * Used by both detectAnomalies (which computes baseline from points)
 * and evaluatePipeline (which gets baseline from SQL aggregation).
 */
function detectAnomalyFromBaseline(
  pipelineId: string,
  metricName: string,
  currentValue: number,
  baseline: Baseline,
  config: RuntimeAnomalyConfig,
): AnomalyDetectionResult[] {
  const results: AnomalyDetectionResult[] = [];

  const mapping = METRIC_ANOMALY_MAP[metricName];
  if (!mapping) return results;

  // Apply minimum stddev floor to avoid false positives on constant metrics.
  // Floor is minStddevFloorPercent% of the mean, so a metric at 1000 needs
  // to deviate by at least 50 * sigmaThreshold = 150 to trigger.
  const stddevFloor =
    Math.abs(baseline.mean) * (config.minStddevFloorPercent / 100);
  const effectiveStddev = Math.max(baseline.stddev, stddevFloor);

  // Prevent division by zero if mean is also zero
  if (effectiveStddev === 0) return results;

  const deviation = currentValue - baseline.mean;
  const deviationFactor = Math.abs(deviation) / effectiveStddev;

  if (deviationFactor < config.sigmaThreshold) {
    return results;
  }

  // Determine direction
  const isSpike = deviation > 0;
  const anomalyType = isSpike ? mapping.spikeType : mapping.dropType;

  // If there's no anomaly type for this direction (e.g. error drop), skip
  if (!anomalyType) return results;

  const severity = classifySeverity(deviationFactor, config.sigmaThreshold);
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

// ─── Baseline cache (15-minute TTL) ─────────────────────────────────────────

const BASELINE_CACHE_TTL_MS = 15 * 60_000; // 15 minutes

interface BaselineCacheEntry {
  /** Baselines keyed by metricName — null when sampleCount < minBaselinePoints */
  baselines: Map<string, Baseline | null>;
  fetchedAt: number;
}

/** Module-level cache keyed by pipelineId */
const baselineCache = new Map<string, BaselineCacheEntry>();

/** Clear all cached baselines (e.g. after config changes). */
export function invalidateBaselineCache(): void {
  baselineCache.clear();
}

// ─── SQL shape for baseline aggregate query ──────────────────────────────────

interface BaselineRow {
  eventsInMean: number | null;
  eventsInStddev: number | null;
  errorsTotalMean: number | null;
  errorsTotalStddev: number | null;
  latencyMeanMsMean: number | null;
  latencyMeanMsStddev: number | null;
  sampleCount: number;
}

// ─── SQL-optimized data fetching ─────────────────────────────────────────────

/** Metrics to evaluate for anomalies. */
const MONITORED_METRICS = ["eventsIn", "errorsTotal", "latencyMeanMs"] as const;

/**
 * Fetch aggregate baseline stats for a single pipeline using a single SQL query.
 * Checks the in-memory cache first; re-fetches when the entry is older than
 * BASELINE_CACHE_TTL_MS. Returns a Map<metricName, Baseline | null>.
 *
 * Returns null entries for metrics where sampleCount < minBaselinePoints
 * or where the aggregate produced no non-null values.
 */
async function fetchBaselineSql(
  pipelineId: string,
  windowStart: Date,
  minBaselinePoints: number,
): Promise<Map<string, Baseline | null>> {
  const now = Date.now();
  const cached = baselineCache.get(pipelineId);
  if (cached && now - cached.fetchedAt < BASELINE_CACHE_TTL_MS) {
    return cached.baselines;
  }

  const rows = await prisma.$queryRawUnsafe<BaselineRow[]>(
    `SELECT
       AVG("eventsIn"::float8)           AS "eventsInMean",
       STDDEV_POP("eventsIn"::float8)    AS "eventsInStddev",
       AVG("errorsTotal"::float8)        AS "errorsTotalMean",
       STDDEV_POP("errorsTotal"::float8) AS "errorsTotalStddev",
       AVG("latencyMeanMs")              AS "latencyMeanMsMean",
       STDDEV_POP("latencyMeanMs")       AS "latencyMeanMsStddev",
       COUNT(*)::int                     AS "sampleCount"
     FROM "PipelineMetric"
     WHERE "pipelineId" = $1
       AND "componentId" IS NULL
       AND "timestamp" >= $2`,
    pipelineId,
    windowStart,
  );

  const row = rows[0];
  const baselines = new Map<string, Baseline | null>();

  if (!row || row.sampleCount < minBaselinePoints) {
    // Insufficient data — null for all metrics
    for (const metric of MONITORED_METRICS) {
      baselines.set(metric, null);
    }
  } else {
    // Build a Baseline for each metric (null if aggregate produced no non-null values)
    const metricDefs: Array<{
      name: string;
      mean: number | null;
      stddev: number | null;
    }> = [
      { name: "eventsIn", mean: row.eventsInMean, stddev: row.eventsInStddev },
      { name: "errorsTotal", mean: row.errorsTotalMean, stddev: row.errorsTotalStddev },
      { name: "latencyMeanMs", mean: row.latencyMeanMsMean, stddev: row.latencyMeanMsStddev },
    ];

    for (const def of metricDefs) {
      if (def.mean === null || def.mean === undefined) {
        baselines.set(def.name, null);
      } else {
        baselines.set(def.name, {
          mean: def.mean,
          stddev: def.stddev ?? 0,
          sampleCount: row.sampleCount,
        });
      }
    }
  }

  baselineCache.set(pipelineId, { baselines, fetchedAt: now });
  return baselines;
}

// ─── SQL shape for current-metrics batch query ───────────────────────────────

interface CurrentMetricRow {
  pipelineId: string;
  eventsIn: bigint;
  errorsTotal: bigint;
  latencyMeanMs: number | null;
}

/**
 * Fetch the most recent aggregate metric row for ALL given pipeline IDs in one
 * DISTINCT ON query. Returns a Map<pipelineId, Record<metricName, number>>.
 * Pipelines with no data are absent from the map.
 */
async function fetchAllCurrentMetrics(
  pipelineIds: string[],
): Promise<Map<string, Record<string, number>>> {
  if (pipelineIds.length === 0) {
    return new Map();
  }

  const rows = await prisma.$queryRawUnsafe<CurrentMetricRow[]>(
    `SELECT DISTINCT ON ("pipelineId")
       "pipelineId",
       "eventsIn",
       "errorsTotal",
       "latencyMeanMs"
     FROM "PipelineMetric"
     WHERE "pipelineId" = ANY($1::text[])
       AND "componentId" IS NULL
     ORDER BY "pipelineId", "timestamp" DESC`,
    pipelineIds,
  );

  const result = new Map<string, Record<string, number>>();
  for (const row of rows) {
    result.set(row.pipelineId, {
      eventsIn: Number(row.eventsIn),
      errorsTotal: Number(row.errorsTotal),
      latencyMeanMs: row.latencyMeanMs ?? 0,
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
  dedupWindowHours: number,
): Promise<boolean> {
  const windowStart = new Date(
    Date.now() - dedupWindowHours * 3600_000,
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
 * Uses SQL-aggregated baseline and the batch current-metrics map when provided,
 * falling back to individual queries otherwise.
 * Persists any newly detected anomalies and returns them.
 */
export async function evaluatePipeline(
  pipeline: {
    id: string;
    environmentId: string;
    environment: { teamId: string | null };
  },
  config?: RuntimeAnomalyConfig,
  currentMetricsMap?: Map<string, Record<string, number>>,
): Promise<AnomalyDetectionResult[]> {
  const cfg = config ?? await getAnomalyConfig();

  // Use pre-fetched batch map when available (evaluateAllPipelines path),
  // otherwise fetch for this single pipeline (standalone evaluatePipeline call)
  const current = currentMetricsMap
    ? (currentMetricsMap.get(pipeline.id) ?? null)
    : ((await fetchAllCurrentMetrics([pipeline.id])).get(pipeline.id) ?? null);

  if (!current) return [];

  const windowStart = new Date(
    Date.now() - cfg.baselineWindowDays * 24 * 3600_000,
  );
  const baselines = await fetchBaselineSql(pipeline.id, windowStart, cfg.minBaselinePoints);
  const allResults: AnomalyDetectionResult[] = [];

  const enabledMetrics = MONITORED_METRICS.filter((m) =>
    cfg.enabledMetrics.includes(m),
  );

  for (const metricName of enabledMetrics) {
    const currentValue = current[metricName];
    if (currentValue === undefined || currentValue === null) continue;

    const baseline = baselines.get(metricName) ?? null;
    if (!baseline) continue; // insufficient historical data for this metric

    const results = detectAnomalyFromBaseline(
      pipeline.id,
      metricName,
      currentValue,
      baseline,
      cfg,
    );

    for (const result of results) {
      // Deduplicate: skip if a recent open anomaly exists for the same type
      const duplicate = await isDuplicate(pipeline.id, result.anomalyType, cfg.dedupWindowHours);
      if (duplicate) continue;

      // Query error context before creating (single write)
      const errorContext = result.anomalyType === "error_rate_spike"
        ? await queryErrorContext(pipeline.id)
        : null;

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
          ...(errorContext ? { errorContext: errorContext as unknown as Prisma.InputJsonValue } : {}),
        },
      });

      allResults.push(result);
    }
  }

  return allResults;
}

/**
 * Evaluate all active (deployed, non-draft) pipelines for anomalies.
 * Uses two SQL queries for the full fleet:
 *   1. One DISTINCT ON batch query for current metrics across all pipelines
 *   2. One AVG/STDDEV_POP query per pipeline (cached for 15 minutes)
 * Called by the background job on the leader instance.
 */
export async function evaluateAllPipelines(): Promise<AnomalyDetectionResult[]> {
  const config = await getAnomalyConfig();

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

  if (pipelines.length === 0) return [];

  const pipelineIds = pipelines.map((p) => p.id);

  // Single batch query for all current metrics
  const currentMetricsMap = await fetchAllCurrentMetrics(pipelineIds);

  const allResults: AnomalyDetectionResult[] = [];

  for (const pipeline of pipelines) {
    // Skip pipelines with no recent metric data
    if (!currentMetricsMap.has(pipeline.id)) continue;

    try {
      const results = await evaluatePipeline(pipeline, config, currentMetricsMap);
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
