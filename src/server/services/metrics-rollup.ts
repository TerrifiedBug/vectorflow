import { adminPrisma } from "@/lib/prisma";
import { withOrgTx } from "@/lib/with-org-tx";
import { infoLog, errorLog } from "@/lib/logger";

/**
 * Long-retention metric rollups (B5).
 *
 * Raw `NodeMetric` / `PipelineMetric` rows are purged at
 * `OrganizationSettings.metricsRetentionDays` (default 7d). This service
 * downsamples them into hourly/daily rollup tables (`NodeMetricRollup`,
 * `PipelineMetricRollup`) that are retained far longer
 * (`metricsRollupRetentionDays`, default 90d) so dashboards/analytics can serve
 * long ranges and chargeback history without keeping every raw sample.
 *
 * The rollup tables are plain Postgres tables (not TimescaleDB hypertables) so
 * this ships standalone, independent of the lake / continuous-aggregate path.
 *
 * Idempotency: each run recomputes a bounded window of *completed* buckets and
 * replaces them per org+granularity (deleteMany the window, then createMany the
 * freshly computed aggregates) inside one `withOrgTx`. Re-running a bucket
 * therefore never double-counts. The window lookback (a few buckets) is far
 * smaller than the raw-retention window, so the raw rows needed to recompute the
 * window always still exist.
 */

export type RollupGranularity = "HOUR" | "DAY";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How many *completed* buckets to recompute each run. A lookback > 1 lets the
 * job self-heal after missed runs and fold in late-arriving raw rows, while
 * staying well inside the raw-retention window.
 */
const DEFAULT_LOOKBACK_BUCKETS: Record<RollupGranularity, number> = {
  HOUR: 3,
  DAY: 2,
};

function bucketMsFor(granularity: RollupGranularity): number {
  return granularity === "DAY" ? DAY_MS : HOUR_MS;
}

/**
 * Truncate `date` to the start of its UTC hour/day bucket. UTC (not the server
 * timezone) keeps bucket boundaries deterministic and DST-immune, and matches
 * how the rollup read path interprets `bucketStart`.
 */
export function truncateToBucketStart(
  date: Date,
  granularity: RollupGranularity,
): Date {
  const d = new Date(date.getTime());
  d.setUTCMilliseconds(0);
  d.setUTCSeconds(0);
  d.setUTCMinutes(0);
  if (granularity === "DAY") {
    d.setUTCHours(0);
  }
  return d;
}

export interface RollupWindow {
  /** Inclusive lower bound of the recomputed bucket window. */
  windowStart: Date;
  /** Exclusive upper bound — the start of the current, still-incomplete bucket. */
  windowEnd: Date;
}

/**
 * Resolve the half-open `[windowStart, windowEnd)` range of completed buckets to
 * recompute. `windowEnd` is the start of the current (incomplete) bucket, so the
 * in-progress bucket is never rolled up until it closes.
 */
export function resolveRollupWindow(
  now: Date,
  granularity: RollupGranularity,
  lookbackBuckets: number = DEFAULT_LOOKBACK_BUCKETS[granularity],
): RollupWindow {
  const bucketMs = bucketMsFor(granularity);
  const windowEnd = truncateToBucketStart(now, granularity);
  const windowStart = new Date(windowEnd.getTime() - lookbackBuckets * bucketMs);
  return { windowStart, windowEnd };
}

// ─── Node rollups ────────────────────────────────────────────────────────────

/** Raw `NodeMetric` columns the rollup reads. */
export interface RawNodeMetric {
  nodeId: string;
  timestamp: Date;
  memoryUsedBytes: bigint;
  memoryTotalBytes: bigint;
  cpuSecondsTotal: number;
  cpuSecondsIdle: number;
  loadAvg1: number;
  loadAvg5: number;
  loadAvg15: number;
  fsUsedBytes: bigint;
  fsTotalBytes: bigint;
  diskReadBytes: bigint;
  diskWrittenBytes: bigint;
  netRxBytes: bigint;
  netTxBytes: bigint;
}

/** One aggregated `NodeMetricRollup` row (gauges averaged, peaks maxed). */
export interface NodeRollupRow {
  nodeId: string;
  bucketStart: Date;
  sampleCount: number;
  memoryUsedBytes: bigint;
  memoryTotalBytes: bigint;
  cpuSecondsTotal: number;
  cpuSecondsIdle: number;
  loadAvg1: number;
  loadAvg5: number;
  loadAvg15: number;
  fsUsedBytes: bigint;
  fsTotalBytes: bigint;
  diskReadBytes: bigint;
  diskWrittenBytes: bigint;
  netRxBytes: bigint;
  netTxBytes: bigint;
  maxMemoryUsedBytes: bigint;
  maxLoadAvg1: number;
}

interface NodeAccumulator {
  nodeId: string;
  bucketStart: Date;
  count: number;
  memoryUsedBytes: bigint;
  memoryTotalBytes: bigint;
  cpuSecondsTotal: number;
  cpuSecondsIdle: number;
  loadAvg1: number;
  loadAvg5: number;
  loadAvg15: number;
  fsUsedBytes: bigint;
  fsTotalBytes: bigint;
  diskReadBytes: bigint;
  diskWrittenBytes: bigint;
  netRxBytes: bigint;
  netTxBytes: bigint;
  maxMemoryUsedBytes: bigint;
  maxLoadAvg1: number;
}

/** Average of a BigInt sum, rounded to the nearest integer (values are >= 0). */
function avgBigInt(sum: bigint, count: number): bigint {
  if (count <= 0) return BigInt(0);
  const n = BigInt(count);
  return (sum + n / BigInt(2)) / n;
}

/**
 * Pure aggregation: bucket raw node metrics by `(nodeId, bucketStart)` and
 * reduce. Gauge columns become the bucket AVERAGE; `maxMemoryUsedBytes` /
 * `maxLoadAvg1` capture the bucket peak; `sampleCount` is the row count.
 */
export function bucketNodeMetrics(
  rows: RawNodeMetric[],
  granularity: RollupGranularity,
): NodeRollupRow[] {
  const acc = new Map<string, NodeAccumulator>();

  for (const row of rows) {
    const bucketStart = truncateToBucketStart(row.timestamp, granularity);
    const key = `${row.nodeId}|${bucketStart.getTime()}`;
    let a = acc.get(key);
    if (!a) {
      a = {
        nodeId: row.nodeId,
        bucketStart,
        count: 0,
        memoryUsedBytes: BigInt(0),
        memoryTotalBytes: BigInt(0),
        cpuSecondsTotal: 0,
        cpuSecondsIdle: 0,
        loadAvg1: 0,
        loadAvg5: 0,
        loadAvg15: 0,
        fsUsedBytes: BigInt(0),
        fsTotalBytes: BigInt(0),
        diskReadBytes: BigInt(0),
        diskWrittenBytes: BigInt(0),
        netRxBytes: BigInt(0),
        netTxBytes: BigInt(0),
        maxMemoryUsedBytes: BigInt(0),
        maxLoadAvg1: 0,
      };
      acc.set(key, a);
    }

    a.count += 1;
    a.memoryUsedBytes += row.memoryUsedBytes;
    a.memoryTotalBytes += row.memoryTotalBytes;
    a.cpuSecondsTotal += row.cpuSecondsTotal;
    a.cpuSecondsIdle += row.cpuSecondsIdle;
    a.loadAvg1 += row.loadAvg1;
    a.loadAvg5 += row.loadAvg5;
    a.loadAvg15 += row.loadAvg15;
    a.fsUsedBytes += row.fsUsedBytes;
    a.fsTotalBytes += row.fsTotalBytes;
    a.diskReadBytes += row.diskReadBytes;
    a.diskWrittenBytes += row.diskWrittenBytes;
    a.netRxBytes += row.netRxBytes;
    a.netTxBytes += row.netTxBytes;
    if (row.memoryUsedBytes > a.maxMemoryUsedBytes) {
      a.maxMemoryUsedBytes = row.memoryUsedBytes;
    }
    if (row.loadAvg1 > a.maxLoadAvg1) {
      a.maxLoadAvg1 = row.loadAvg1;
    }
  }

  return Array.from(acc.values()).map((a) => ({
    nodeId: a.nodeId,
    bucketStart: a.bucketStart,
    sampleCount: a.count,
    memoryUsedBytes: avgBigInt(a.memoryUsedBytes, a.count),
    memoryTotalBytes: avgBigInt(a.memoryTotalBytes, a.count),
    cpuSecondsTotal: a.cpuSecondsTotal / a.count,
    cpuSecondsIdle: a.cpuSecondsIdle / a.count,
    loadAvg1: a.loadAvg1 / a.count,
    loadAvg5: a.loadAvg5 / a.count,
    loadAvg15: a.loadAvg15 / a.count,
    fsUsedBytes: avgBigInt(a.fsUsedBytes, a.count),
    fsTotalBytes: avgBigInt(a.fsTotalBytes, a.count),
    diskReadBytes: avgBigInt(a.diskReadBytes, a.count),
    diskWrittenBytes: avgBigInt(a.diskWrittenBytes, a.count),
    netRxBytes: avgBigInt(a.netRxBytes, a.count),
    netTxBytes: avgBigInt(a.netTxBytes, a.count),
    maxMemoryUsedBytes: a.maxMemoryUsedBytes,
    maxLoadAvg1: a.maxLoadAvg1,
  }));
}

// ─── Pipeline rollups ────────────────────────────────────────────────────────

/** Raw `PipelineMetric` columns the rollup reads. */
export interface RawPipelineMetric {
  pipelineId: string;
  nodeId: string | null;
  componentId: string | null;
  timestamp: Date;
  eventsIn: bigint;
  eventsOut: bigint;
  eventsDiscarded: bigint;
  errorsTotal: bigint;
  bytesIn: bigint;
  bytesOut: bigint;
  spansIn: bigint;
  spansOut: bigint;
  tracesIn: bigint;
  utilization: number;
  latencyMeanMs: number | null;
}

/** One aggregated `PipelineMetricRollup` row. */
export interface PipelineRollupRow {
  pipelineId: string;
  componentId: string;
  bucketStart: Date;
  sampleCount: number;
  eventsIn: bigint;
  eventsOut: bigint;
  eventsDiscarded: bigint;
  errorsTotal: bigint;
  bytesIn: bigint;
  bytesOut: bigint;
  spansIn: bigint;
  spansOut: bigint;
  tracesIn: bigint;
  utilization: number;
  latencyMeanMs: number | null;
  maxLatencyMs: number | null;
}

interface PipelineAccumulator {
  pipelineId: string;
  componentId: string;
  bucketStart: Date;
  count: number;
  eventsIn: bigint;
  eventsOut: bigint;
  eventsDiscarded: bigint;
  errorsTotal: bigint;
  bytesIn: bigint;
  bytesOut: bigint;
  spansIn: bigint;
  spansOut: bigint;
  tracesIn: bigint;
  utilizationSum: number;
  latencySum: number;
  latencyCount: number;
  maxLatencyMs: number | null;
}

/**
 * Pure aggregation: bucket raw pipeline metrics by
 * `(pipelineId, componentId, bucketStart)` and reduce. Counters become the
 * bucket SUM; utilization/latency become the AVERAGE; `maxLatencyMs` the peak.
 *
 * `PipelineMetric` carries three row kinds for one pipeline+timestamp:
 *   - pipeline aggregate `(nodeId = null, componentId = null)`
 *   - per-node aggregate `(nodeId set,  componentId = null)`  ← sums into the above
 *   - per-component       `(componentId set)`
 *
 * The per-node rows are the addends of the pipeline aggregate, so folding them
 * into the `componentId = ""` bucket would double-count. We therefore keep ONLY
 * the pipeline-aggregate rows for the `""` bucket (matching every read in the
 * codebase, which filters `nodeId: null, componentId: null`) and keep the
 * per-component rows under their own `componentId`.
 */
export function bucketPipelineMetrics(
  rows: RawPipelineMetric[],
  granularity: RollupGranularity,
): PipelineRollupRow[] {
  const acc = new Map<string, PipelineAccumulator>();

  for (const row of rows) {
    // Drop per-node aggregate rows; the pipeline-aggregate row already sums them.
    if (row.componentId === null && row.nodeId !== null) continue;

    const componentId = row.componentId ?? "";
    const bucketStart = truncateToBucketStart(row.timestamp, granularity);
    const key = `${row.pipelineId}|${componentId}|${bucketStart.getTime()}`;
    let a = acc.get(key);
    if (!a) {
      a = {
        pipelineId: row.pipelineId,
        componentId,
        bucketStart,
        count: 0,
        eventsIn: BigInt(0),
        eventsOut: BigInt(0),
        eventsDiscarded: BigInt(0),
        errorsTotal: BigInt(0),
        bytesIn: BigInt(0),
        bytesOut: BigInt(0),
        spansIn: BigInt(0),
        spansOut: BigInt(0),
        tracesIn: BigInt(0),
        utilizationSum: 0,
        latencySum: 0,
        latencyCount: 0,
        maxLatencyMs: null,
      };
      acc.set(key, a);
    }

    a.count += 1;
    a.eventsIn += row.eventsIn;
    a.eventsOut += row.eventsOut;
    a.eventsDiscarded += row.eventsDiscarded;
    a.errorsTotal += row.errorsTotal;
    a.bytesIn += row.bytesIn;
    a.bytesOut += row.bytesOut;
    a.spansIn += row.spansIn;
    a.spansOut += row.spansOut;
    a.tracesIn += row.tracesIn;
    a.utilizationSum += row.utilization;
    if (row.latencyMeanMs !== null) {
      a.latencySum += row.latencyMeanMs;
      a.latencyCount += 1;
      if (a.maxLatencyMs === null || row.latencyMeanMs > a.maxLatencyMs) {
        a.maxLatencyMs = row.latencyMeanMs;
      }
    }
  }

  return Array.from(acc.values()).map((a) => ({
    pipelineId: a.pipelineId,
    componentId: a.componentId,
    bucketStart: a.bucketStart,
    sampleCount: a.count,
    eventsIn: a.eventsIn,
    eventsOut: a.eventsOut,
    eventsDiscarded: a.eventsDiscarded,
    errorsTotal: a.errorsTotal,
    bytesIn: a.bytesIn,
    bytesOut: a.bytesOut,
    spansIn: a.spansIn,
    spansOut: a.spansOut,
    tracesIn: a.tracesIn,
    utilization: a.count > 0 ? a.utilizationSum / a.count : 0,
    latencyMeanMs: a.latencyCount > 0 ? a.latencySum / a.latencyCount : null,
    maxLatencyMs: a.maxLatencyMs,
  }));
}

// ─── Orchestration ───────────────────────────────────────────────────────────

export interface RollupResult {
  granularity: RollupGranularity;
  organizations: number;
  nodeRollups: number;
  pipelineRollups: number;
  windowStart: Date;
  windowEnd: Date;
}

interface OrgRollupCounts {
  nodeRollups: number;
  pipelineRollups: number;
}

async function rollupOrg(
  organizationId: string,
  granularity: RollupGranularity,
  window: RollupWindow,
): Promise<OrgRollupCounts> {
  return withOrgTx(organizationId, async (tx) => {
    const nodeRows = (await tx.nodeMetric.findMany({
      where: {
        organizationId,
        timestamp: { gte: window.windowStart, lt: window.windowEnd },
      },
      select: {
        nodeId: true,
        timestamp: true,
        memoryUsedBytes: true,
        memoryTotalBytes: true,
        cpuSecondsTotal: true,
        cpuSecondsIdle: true,
        loadAvg1: true,
        loadAvg5: true,
        loadAvg15: true,
        fsUsedBytes: true,
        fsTotalBytes: true,
        diskReadBytes: true,
        diskWrittenBytes: true,
        netRxBytes: true,
        netTxBytes: true,
      },
    })) as RawNodeMetric[];

    const pipeRows = (await tx.pipelineMetric.findMany({
      where: {
        organizationId,
        timestamp: { gte: window.windowStart, lt: window.windowEnd },
        // Pipeline-aggregate rows + per-component rows only. Per-node aggregate
        // rows (nodeId set, componentId null) are excluded here so they cannot
        // double-count into the "" bucket — see bucketPipelineMetrics().
        OR: [
          { nodeId: null, componentId: null },
          { componentId: { not: null } },
        ],
      },
      select: {
        pipelineId: true,
        nodeId: true,
        componentId: true,
        timestamp: true,
        eventsIn: true,
        eventsOut: true,
        eventsDiscarded: true,
        errorsTotal: true,
        bytesIn: true,
        bytesOut: true,
        spansIn: true,
        spansOut: true,
        tracesIn: true,
        utilization: true,
        latencyMeanMs: true,
      },
    })) as RawPipelineMetric[];

    const nodeRollupRows = bucketNodeMetrics(nodeRows, granularity);
    const pipeRollupRows = bucketPipelineMetrics(pipeRows, granularity);

    // Replace the recomputed window atomically so re-runs are idempotent.
    await tx.nodeMetricRollup.deleteMany({
      where: {
        organizationId,
        granularity,
        bucketStart: { gte: window.windowStart, lt: window.windowEnd },
      },
    });
    if (nodeRollupRows.length > 0) {
      await tx.nodeMetricRollup.createMany({
        data: nodeRollupRows.map((r) => ({
          organizationId,
          granularity,
          nodeId: r.nodeId,
          bucketStart: r.bucketStart,
          sampleCount: r.sampleCount,
          memoryUsedBytes: r.memoryUsedBytes,
          memoryTotalBytes: r.memoryTotalBytes,
          cpuSecondsTotal: r.cpuSecondsTotal,
          cpuSecondsIdle: r.cpuSecondsIdle,
          loadAvg1: r.loadAvg1,
          loadAvg5: r.loadAvg5,
          loadAvg15: r.loadAvg15,
          fsUsedBytes: r.fsUsedBytes,
          fsTotalBytes: r.fsTotalBytes,
          diskReadBytes: r.diskReadBytes,
          diskWrittenBytes: r.diskWrittenBytes,
          netRxBytes: r.netRxBytes,
          netTxBytes: r.netTxBytes,
          maxMemoryUsedBytes: r.maxMemoryUsedBytes,
          maxLoadAvg1: r.maxLoadAvg1,
        })),
      });
    }

    await tx.pipelineMetricRollup.deleteMany({
      where: {
        organizationId,
        granularity,
        bucketStart: { gte: window.windowStart, lt: window.windowEnd },
      },
    });
    if (pipeRollupRows.length > 0) {
      await tx.pipelineMetricRollup.createMany({
        data: pipeRollupRows.map((r) => ({
          organizationId,
          granularity,
          pipelineId: r.pipelineId,
          componentId: r.componentId,
          bucketStart: r.bucketStart,
          sampleCount: r.sampleCount,
          eventsIn: r.eventsIn,
          eventsOut: r.eventsOut,
          eventsDiscarded: r.eventsDiscarded,
          errorsTotal: r.errorsTotal,
          bytesIn: r.bytesIn,
          bytesOut: r.bytesOut,
          spansIn: r.spansIn,
          spansOut: r.spansOut,
          tracesIn: r.tracesIn,
          utilization: r.utilization,
          latencyMeanMs: r.latencyMeanMs,
          maxLatencyMs: r.maxLatencyMs,
        })),
      });
    }

    return {
      nodeRollups: nodeRollupRows.length,
      pipelineRollups: pipeRollupRows.length,
    };
  });
}

/**
 * Roll up raw metrics into the downsampled rollup tables for the given
 * granularity, across every active organization. Idempotent: recomputes only a
 * bounded window of completed buckets and replaces them per org.
 */
export async function rollupMetrics(input: {
  granularity: RollupGranularity;
  now?: Date;
  lookbackBuckets?: number;
}): Promise<RollupResult> {
  const now = input.now ?? new Date();
  const window = resolveRollupWindow(now, input.granularity, input.lookbackBuckets);

  // Cross-tenant enumeration (admin client, no org scope) — each org's rollup
  // then runs inside its own tenant-scoped transaction.
  const orgs = await adminPrisma.organization.findMany({
    where: { suspendedAt: null, deletedAt: null },
    select: { id: true },
  });

  let nodeRollups = 0;
  let pipelineRollups = 0;

  for (const org of orgs) {
    try {
      const counts = await rollupOrg(org.id, input.granularity, window);
      nodeRollups += counts.nodeRollups;
      pipelineRollups += counts.pipelineRollups;
    } catch (err) {
      errorLog(
        "metrics-rollup",
        `org=${org.id} ${input.granularity} rollup error (continuing)`,
        err,
      );
    }
  }

  return {
    granularity: input.granularity,
    organizations: orgs.length,
    nodeRollups,
    pipelineRollups,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
  };
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

/** Run the rollup sweep hourly; DAY buckets only close once per day but the
 *  idempotent recompute keeps them fresh and self-healing across restarts. */
const ROLLUP_INTERVAL_MS = HOUR_MS;

let timer: ReturnType<typeof setInterval> | null = null;

async function runRollupTick(): Promise<void> {
  for (const granularity of ["HOUR", "DAY"] as const) {
    try {
      const result = await rollupMetrics({ granularity });
      infoLog(
        "metrics-rollup",
        `${granularity} rollup: orgs=${result.organizations} node=${result.nodeRollups} pipeline=${result.pipelineRollups}`,
      );
    } catch (err) {
      errorLog("metrics-rollup", `${granularity} rollup sweep failed`, err);
    }
  }
}

/**
 * Start the leader-gated rollup scheduler. Runs once on startup, then hourly.
 * Idempotent — a second call while already running is a no-op.
 */
export function initMetricsRollupScheduler(): void {
  if (timer) return;

  const tick = () => {
    void runRollupTick();
  };

  tick();
  timer = setInterval(tick, ROLLUP_INTERVAL_MS);
  // Background sweep must not keep the process alive on its own.
  timer.unref?.();

  infoLog(
    "metrics-rollup",
    `rollup scheduler started (every ${ROLLUP_INTERVAL_MS}ms)`,
  );
}

export function _stopMetricsRollupSchedulerForTests(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
