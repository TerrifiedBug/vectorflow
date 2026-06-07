import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { infoLog, errorLog } from "@/lib/logger";
import { queryErrorContext } from "@/server/services/error-context";
import { correlateAnomalyEvent } from "@/server/services/alert-correlator";
import { getOrgSettings } from "@/lib/org-settings";
import { DEFAULT_ORG_ID } from "@/lib/org-constants";

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
  /** Use seasonal (hour-of-day + weekday/weekend) baselines so daily/weekly traffic cycles don't read as anomalies. */
  SEASONALITY_ENABLED: true,
  /** Slack (in hours) around the current hour-of-day when selecting the seasonal bucket (±N). */
  SEASONAL_HOUR_TOLERANCE: 1,
  /** Minimum samples in the seasonal bucket before trusting it; below this, fall back to the global z-score baseline. */
  MIN_SEASONAL_POINTS: 8,
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
  seasonalityEnabled: boolean;
  seasonalHourTolerance: number;
  minSeasonalPoints: number;
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
    const settings = await getOrgSettings(DEFAULT_ORG_ID);

    cachedConfig = {
      baselineWindowDays: settings.anomalyBaselineWindowDays ?? ANOMALY_CONFIG.BASELINE_WINDOW_DAYS,
      sigmaThreshold: settings.anomalySigmaThreshold ?? ANOMALY_CONFIG.SIGMA_THRESHOLD,
      minBaselinePoints: ANOMALY_CONFIG.MIN_BASELINE_POINTS, // not user-configurable
      minStddevFloorPercent: settings.anomalyMinStddevFloorPercent ?? ANOMALY_CONFIG.MIN_STDDEV_FLOOR_PERCENT,
      pollIntervalMs: ANOMALY_CONFIG.POLL_INTERVAL_MS, // not user-configurable
      dedupWindowHours: settings.anomalyDedupWindowHours ?? ANOMALY_CONFIG.DEDUP_WINDOW_HOURS,
      enabledMetrics: settings.anomalyEnabledMetrics
        ? settings.anomalyEnabledMetrics.split(",").map((s) => s.trim()).filter(Boolean)
        : ["eventsIn", "errorsTotal", "latencyMeanMs"],
      seasonalityEnabled: ANOMALY_CONFIG.SEASONALITY_ENABLED,
      seasonalHourTolerance: ANOMALY_CONFIG.SEASONAL_HOUR_TOLERANCE,
      minSeasonalPoints: ANOMALY_CONFIG.MIN_SEASONAL_POINTS,
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
      seasonalityEnabled: ANOMALY_CONFIG.SEASONALITY_ENABLED,
      seasonalHourTolerance: ANOMALY_CONFIG.SEASONAL_HOUR_TOLERANCE,
      minSeasonalPoints: ANOMALY_CONFIG.MIN_SEASONAL_POINTS,
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
  spansIn: {
    spikeType: "throughput_spike",
    dropType: "throughput_drop",
  },
  tracesIn: {
    spikeType: "throughput_spike",
    dropType: "throughput_drop",
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
 * Circular distance between two hours-of-day (0–23), accounting for the
 * midnight wraparound (hour 23 and hour 1 are 2 apart, not 22).
 */
export function hourCircularDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 24 - d);
}

/** True when a UTC weekday index (0=Sun … 6=Sat) is a weekend day. */
function isWeekendDay(dayOfWeek: number): boolean {
  return dayOfWeek === 0 || dayOfWeek === 6;
}

/**
 * Whether a historical point shares `now`'s seasonal bucket: the same
 * weekday/weekend half of the week AND an hour-of-day within
 * [nowHour ± hourTolerance] (UTC, wraparound-aware).
 */
export function inSeasonalBucket(
  pointTimestamp: Date,
  now: Date,
  hourTolerance: number,
): boolean {
  if (
    isWeekendDay(pointTimestamp.getUTCDay()) !== isWeekendDay(now.getUTCDay())
  ) {
    return false;
  }
  return (
    hourCircularDistance(pointTimestamp.getUTCHours(), now.getUTCHours()) <=
    hourTolerance
  );
}

/**
 * Seasonality-aware baseline. Restricts the baseline to points sharing `now`'s
 * seasonal bucket so a metric that is high every afternoon is compared against
 * past afternoons, not the flat 24h mean — the dominant source of false-positive
 * anomalies on cyclic traffic.
 *
 * Falls back to the global baseline (z-score over all points) when the seasonal
 * bucket holds fewer than `minSeasonalPoints` samples, so sparse history never
 * makes detection worse than the non-seasonal path.
 */
export function computeSeasonalBaseline(
  points: MetricDataPoint[],
  now: Date,
  hourTolerance: number,
  minSeasonalPoints: number,
): { baseline: Baseline | null; seasonal: boolean } {
  const seasonalPoints = points.filter((p) =>
    inSeasonalBucket(p.timestamp, now, hourTolerance),
  );
  if (seasonalPoints.length >= minSeasonalPoints) {
    const baseline = computeBaseline(seasonalPoints);
    if (baseline) return { baseline, seasonal: true };
  }
  return { baseline: computeBaseline(points), seasonal: false };
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
    spansIn: "spans/interval",
    tracesIn: "traces/interval",
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
    seasonalityEnabled: ANOMALY_CONFIG.SEASONALITY_ENABLED,
    seasonalHourTolerance: ANOMALY_CONFIG.SEASONAL_HOUR_TOLERANCE,
    minSeasonalPoints: ANOMALY_CONFIG.MIN_SEASONAL_POINTS,
  },
  now?: Date,
): AnomalyDetectionResult[] {
  const results: AnomalyDetectionResult[] = [];

  // Need sufficient historical data
  if (baselinePoints.length < config.minBaselinePoints) {
    return results;
  }

  // Seasonal baseline (when an evaluation time is supplied) compares the current
  // value against the same time-of-day + weekday/weekend history, falling back
  // to the global z-score baseline when the seasonal bucket is too sparse.
  // Without `now`, this is the plain global baseline (deterministic).
  const baseline =
    config.seasonalityEnabled && now
      ? computeSeasonalBaseline(
          baselinePoints,
          now,
          config.seasonalHourTolerance,
          config.minSeasonalPoints,
        ).baseline
      : computeBaseline(baselinePoints);
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
  /** Seasonal bucket identity this entry was computed for; a mismatch is a cache miss. */
  bucketKey: string;
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
  spansInMean: number | null;
  spansInStddev: number | null;
  tracesInMean: number | null;
  tracesInStddev: number | null;
  sampleCount: number;
  eventsInSeasonalMean: number | null;
  eventsInSeasonalStddev: number | null;
  errorsTotalSeasonalMean: number | null;
  errorsTotalSeasonalStddev: number | null;
  latencyMeanMsSeasonalMean: number | null;
  latencyMeanMsSeasonalStddev: number | null;
  spansInSeasonalMean: number | null;
  spansInSeasonalStddev: number | null;
  tracesInSeasonalMean: number | null;
  tracesInSeasonalStddev: number | null;
  eventsInSeasonalCount: number;
  errorsTotalSeasonalCount: number;
  latencyMeanMsSeasonalCount: number;
  spansInSeasonalCount: number;
  tracesInSeasonalCount: number;
}

// ─── SQL-optimized data fetching ─────────────────────────────────────────────

/** Metrics to evaluate for anomalies. */
const MONITORED_METRICS = [
  "eventsIn",
  "errorsTotal",
  "latencyMeanMs",
  "spansIn",
  "tracesIn",
] as const;

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
  bucketTime: Date,
  seasonalityEnabled: boolean,
  hourTolerance: number,
  minSeasonalPoints: number,
): Promise<Map<string, Baseline | null>> {
  const fetchTime = Date.now();

  // Seasonal bucket parameters from the metric's own timestamp (UTC, to match
  // how Prisma stores DateTime and the JS getUTC* helpers).
  const bucketHour = bucketTime.getUTCHours();
  const bucketWeekend = isWeekendDay(bucketTime.getUTCDay());

  // A cached baseline is only valid for the same seasonal bucket; a different
  // hour/weekday (or seasonality disabled) must re-fetch rather than reuse a
  // stale profile. "global" keeps full caching when seasonality is off.
  const bucketKey = seasonalityEnabled
    ? `${bucketHour}:${bucketWeekend ? "we" : "wd"}:${hourTolerance}:${minSeasonalPoints}`
    : "global";

  const cached = baselineCache.get(pipelineId);
  if (
    cached &&
    cached.bucketKey === bucketKey &&
    fetchTime - cached.fetchedAt < BASELINE_CACHE_TTL_MS
  ) {
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
       AVG("spansIn"::float8)            AS "spansInMean",
       STDDEV_POP("spansIn"::float8)     AS "spansInStddev",
       AVG("tracesIn"::float8)           AS "tracesInMean",
       STDDEV_POP("tracesIn"::float8)    AS "tracesInStddev",
       COUNT(*)::int                     AS "sampleCount",
       AVG("eventsIn"::float8)           FILTER (WHERE seasonal) AS "eventsInSeasonalMean",
       STDDEV_POP("eventsIn"::float8)    FILTER (WHERE seasonal) AS "eventsInSeasonalStddev",
       AVG("errorsTotal"::float8)        FILTER (WHERE seasonal) AS "errorsTotalSeasonalMean",
       STDDEV_POP("errorsTotal"::float8) FILTER (WHERE seasonal) AS "errorsTotalSeasonalStddev",
       AVG("latencyMeanMs")              FILTER (WHERE seasonal) AS "latencyMeanMsSeasonalMean",
       STDDEV_POP("latencyMeanMs")       FILTER (WHERE seasonal) AS "latencyMeanMsSeasonalStddev",
       AVG("spansIn"::float8)            FILTER (WHERE seasonal) AS "spansInSeasonalMean",
       STDDEV_POP("spansIn"::float8)     FILTER (WHERE seasonal) AS "spansInSeasonalStddev",
       AVG("tracesIn"::float8)           FILTER (WHERE seasonal) AS "tracesInSeasonalMean",
       STDDEV_POP("tracesIn"::float8)    FILTER (WHERE seasonal) AS "tracesInSeasonalStddev",
       COUNT("eventsIn") FILTER (WHERE seasonal)::int      AS "eventsInSeasonalCount",
       COUNT("errorsTotal") FILTER (WHERE seasonal)::int   AS "errorsTotalSeasonalCount",
       COUNT("latencyMeanMs") FILTER (WHERE seasonal)::int AS "latencyMeanMsSeasonalCount",
       COUNT("spansIn") FILTER (WHERE seasonal)::int       AS "spansInSeasonalCount",
       COUNT("tracesIn") FILTER (WHERE seasonal)::int      AS "tracesInSeasonalCount"
     FROM (
       SELECT "eventsIn", "errorsTotal", "latencyMeanMs", "spansIn", "tracesIn",
         (
           (EXTRACT(DOW FROM "timestamp") IN (0, 6)) = $3
           AND LEAST(
                 ABS(EXTRACT(HOUR FROM "timestamp") - $4),
                 24 - ABS(EXTRACT(HOUR FROM "timestamp") - $4)
               ) <= $5
         ) AS seasonal
       FROM "PipelineMetric"
       WHERE "pipelineId" = $1
         AND "componentId" IS NULL
         AND "timestamp" >= $2
        AND "timestamp" < $6
     ) t`,
    pipelineId,
    windowStart,
    bucketWeekend,
    bucketHour,
    hourTolerance,
    // Exclude the row under evaluation (the latest row, == bucketTime) from its
    // own baseline so a sparse seasonal bucket can't mask the very spike tested.
    bucketTime,
  );

  const row = rows[0];
  const baselines = new Map<string, Baseline | null>();

  if (!row || row.sampleCount < minBaselinePoints) {
    // Insufficient data — null for all metrics
    for (const metric of MONITORED_METRICS) {
      baselines.set(metric, null);
    }
  } else {
    // Prefer the seasonal bucket per metric when it holds enough non-null
    // samples; otherwise the global baseline (z-score over the whole window) is
    // the fallback. Per-metric counts matter because a nullable metric
    // (latencyMeanMs) can be sparse inside an otherwise-dense time bucket.
    const metricDefs: Array<{
      name: string;
      mean: number | null;
      stddev: number | null;
      seasonalMean: number | null;
      seasonalStddev: number | null;
      seasonalCount: number;
    }> = [
      { name: "eventsIn", mean: row.eventsInMean, stddev: row.eventsInStddev, seasonalMean: row.eventsInSeasonalMean, seasonalStddev: row.eventsInSeasonalStddev, seasonalCount: row.eventsInSeasonalCount },
      { name: "errorsTotal", mean: row.errorsTotalMean, stddev: row.errorsTotalStddev, seasonalMean: row.errorsTotalSeasonalMean, seasonalStddev: row.errorsTotalSeasonalStddev, seasonalCount: row.errorsTotalSeasonalCount },
      { name: "latencyMeanMs", mean: row.latencyMeanMsMean, stddev: row.latencyMeanMsStddev, seasonalMean: row.latencyMeanMsSeasonalMean, seasonalStddev: row.latencyMeanMsSeasonalStddev, seasonalCount: row.latencyMeanMsSeasonalCount },
      { name: "spansIn", mean: row.spansInMean, stddev: row.spansInStddev, seasonalMean: row.spansInSeasonalMean, seasonalStddev: row.spansInSeasonalStddev, seasonalCount: row.spansInSeasonalCount },
      { name: "tracesIn", mean: row.tracesInMean, stddev: row.tracesInStddev, seasonalMean: row.tracesInSeasonalMean, seasonalStddev: row.tracesInSeasonalStddev, seasonalCount: row.tracesInSeasonalCount },
    ];

    for (const def of metricDefs) {
      const useSeasonal =
        seasonalityEnabled &&
        def.seasonalCount >= minSeasonalPoints &&
        def.seasonalMean != null;
      const mean = useSeasonal ? def.seasonalMean : def.mean;
      const stddev = useSeasonal ? def.seasonalStddev : def.stddev;
      if (mean === null || mean === undefined) {
        baselines.set(def.name, null);
      } else {
        baselines.set(def.name, {
          mean,
          stddev: stddev ?? 0,
          sampleCount: useSeasonal ? def.seasonalCount : row.sampleCount,
        });
      }
    }
  }

  baselineCache.set(pipelineId, { baselines, fetchedAt: fetchTime, bucketKey });
  return baselines;
}

// ─── SQL shape for current-metrics batch query ───────────────────────────────

interface CurrentMetricRow {
  pipelineId: string;
  eventsIn: bigint;
  errorsTotal: bigint;
  spansIn: bigint;
  tracesIn: bigint;
  latencyMeanMs: number | null;
  timestamp: Date;
}

/** Latest metric values for a pipeline plus the timestamp of that row. */
export interface CurrentMetricSnapshot {
  values: Record<string, number>;
  timestamp: Date;
}

/**
 * Fetch the most recent aggregate metric row for ALL given pipeline IDs in one
 * DISTINCT ON query. Returns a Map<pipelineId, Record<metricName, number>>.
 * Pipelines with no data are absent from the map.
 */
async function fetchAllCurrentMetrics(
  pipelineIds: string[],
): Promise<Map<string, CurrentMetricSnapshot>> {
  if (pipelineIds.length === 0) {
    return new Map();
  }

  const rows = await prisma.$queryRawUnsafe<CurrentMetricRow[]>(
    `SELECT DISTINCT ON ("pipelineId")
       "pipelineId",
       "eventsIn",
       "errorsTotal",
       "spansIn",
       "tracesIn",
       "latencyMeanMs",
       "timestamp"
     FROM "PipelineMetric"
     WHERE "pipelineId" = ANY($1::text[])
       AND "componentId" IS NULL
     ORDER BY "pipelineId", "timestamp" DESC`,
    pipelineIds,
  );

  const result = new Map<string, CurrentMetricSnapshot>();
  for (const row of rows) {
    result.set(row.pipelineId, {
      values: {
        eventsIn: Number(row.eventsIn),
        errorsTotal: Number(row.errorsTotal),
        spansIn: Number(row.spansIn),
        tracesIn: Number(row.tracesIn),
        latencyMeanMs: row.latencyMeanMs ?? 0,
      },
      timestamp: row.timestamp ?? new Date(),
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
  currentMetricsMap?: Map<string, CurrentMetricSnapshot>,
): Promise<AnomalyDetectionResult[]> {
  const cfg = config ?? await getAnomalyConfig();

  // Use pre-fetched batch map when available (evaluateAllPipelines path),
  // otherwise fetch for this single pipeline (standalone evaluatePipeline call)
  const snapshot = currentMetricsMap
    ? (currentMetricsMap.get(pipeline.id) ?? null)
    : ((await fetchAllCurrentMetrics([pipeline.id])).get(pipeline.id) ?? null);

  if (!snapshot) return [];

  const current = snapshot.values;
  // The baseline window tracks wall-clock so a cached baseline stays valid
  // within its TTL (the window barely moves in 15 min). The seasonal bucket
  // keys off the metric's own timestamp, so a delayed/stale latest row is
  // compared against its own time-of-day rather than wall-clock.
  const now = new Date();
  const windowStart = new Date(
    now.getTime() - cfg.baselineWindowDays * 24 * 3600_000,
  );
  const baselines = await fetchBaselineSql(
    pipeline.id,
    windowStart,
    cfg.minBaselinePoints,
    snapshot.timestamp,
    cfg.seasonalityEnabled,
    cfg.seasonalHourTolerance,
    cfg.minSeasonalPoints,
  );
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
      const anomalyEvent = await prisma.anomalyEvent.create({
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

      try {
        await correlateAnomalyEvent(anomalyEvent);
      } catch (error) {
        errorLog(
          "anomaly-detector",
          `failed to correlate anomaly ${anomalyEvent.id}`,
          error,
        );
      }

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
/**
 * Evaluate every deployed pipeline for anomalies.
 *
 * When `opts.organizationId` is supplied the query is filtered to that
 * org — used by the per-org tick in `anomaly-detection-job.ts` to keep
 * one tenant's analysis from blocking another's under strict-multi-tenant
 * RLS.
 *
 * Note: `getAnomalyConfig` still reads the DEFAULT_ORG_ID settings as
 * the source of truth. Per-org config caching is a follow-up — see
 * "config-per-org" tracking issue. For now every org shares the tunable
 * knobs of whatever org owns the default OrganizationSettings.
 */
export async function evaluateAllPipelines(
  opts: { organizationId?: string } = {},
): Promise<AnomalyDetectionResult[]> {
  const config = await getAnomalyConfig();

  const where: Record<string, unknown> = {
    isDraft: false,
    deployedAt: { not: null },
  };
  if (opts.organizationId) {
    where.organizationId = opts.organizationId;
  }

  const pipelines = await prisma.pipeline.findMany({
    where,
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
      errorLog(
        "anomaly-detector",
        `Error evaluating pipeline ${pipeline.id}`,
        err,
      );
    }
  }

  if (allResults.length > 0) {
    infoLog(
      "anomaly-detector",
      `Detected ${allResults.length} anomalies across ${pipelines.length} pipelines`,
    );
  }

  return allResults;
}
