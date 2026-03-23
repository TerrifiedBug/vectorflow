export interface MetricSample {
  timestamp: number;
  receivedEventsRate: number;
  sentEventsRate: number;
  receivedBytesRate: number;
  sentBytesRate: number;
  errorCount: number;
  errorsRate: number;
  discardedRate: number;
  latencyMeanMs: number | null; // mean pipeline latency in ms
}

interface PrevTotals {
  timestamp: number;
  receivedEventsTotal: number;
  sentEventsTotal: number;
  receivedBytesTotal: number;
  sentBytesTotal: number;
  errorsTotal: number;
  discardedTotal: number;
  latencyMeanSeconds: number | null;
}

const MAX_SAMPLES = 720; // 1 hour at 5s intervals

export class MetricStore {
  private samples = new Map<string, MetricSample[]>();
  private prevTotals = new Map<string, PrevTotals>();

  recordTotals(
    nodeId: string,
    pipelineId: string,
    componentId: string,
    totals: {
      receivedEventsTotal: number;
      sentEventsTotal: number;
      receivedBytesTotal?: number;
      sentBytesTotal?: number;
      errorsTotal?: number;
      discardedTotal?: number;
      latencyMeanSeconds?: number;
    },
  ): MetricSample | null {
    const key = `${nodeId}:${pipelineId}:${componentId}`;
    const now = Date.now();
    const prev = this.prevTotals.get(key);

    this.prevTotals.set(key, {
      timestamp: now,
      receivedEventsTotal: totals.receivedEventsTotal,
      sentEventsTotal: totals.sentEventsTotal,
      receivedBytesTotal: totals.receivedBytesTotal ?? 0,
      sentBytesTotal: totals.sentBytesTotal ?? 0,
      errorsTotal: totals.errorsTotal ?? 0,
      discardedTotal: totals.discardedTotal ?? 0,
      latencyMeanSeconds: totals.latencyMeanSeconds ?? null,
    });

    if (!prev) return null;

    const elapsedSec = (now - prev.timestamp) / 1000;
    if (elapsedSec <= 0) return null;

    const sample: MetricSample = {
      timestamp: now,
      receivedEventsRate: Math.max(0, (totals.receivedEventsTotal - prev.receivedEventsTotal) / elapsedSec),
      sentEventsRate: Math.max(0, (totals.sentEventsTotal - prev.sentEventsTotal) / elapsedSec),
      receivedBytesRate: Math.max(0, ((totals.receivedBytesTotal ?? 0) - prev.receivedBytesTotal) / elapsedSec),
      sentBytesRate: Math.max(0, ((totals.sentBytesTotal ?? 0) - prev.sentBytesTotal) / elapsedSec),
      errorCount: totals.errorsTotal ?? 0,
      errorsRate: Math.max(0, ((totals.errorsTotal ?? 0) - prev.errorsTotal) / elapsedSec),
      discardedRate: Math.max(0, ((totals.discardedTotal ?? 0) - prev.discardedTotal) / elapsedSec),
      latencyMeanMs: totals.latencyMeanSeconds != null ? totals.latencyMeanSeconds * 1000 : null,
    };

    const arr = this.samples.get(key) ?? [];
    arr.push(sample);
    if (arr.length > MAX_SAMPLES) arr.shift();
    this.samples.set(key, arr);

    return sample;
  }

  getSamples(nodeId: string, pipelineId: string, componentId: string, minutes = 60): MetricSample[] {
    const key = `${nodeId}:${pipelineId}:${componentId}`;
    const arr = this.samples.get(key) ?? [];
    const cutoff = Date.now() - minutes * 60 * 1000;
    return arr.filter((s) => s.timestamp >= cutoff);
  }

  /** Get all component metrics for a specific pipeline across all nodes. */
  getAllForPipeline(nodeId: string, pipelineId: string, minutes = 60): Map<string, MetricSample[]> {
    const result = new Map<string, MetricSample[]>();
    const prefix = `${nodeId}:${pipelineId}:`;
    const cutoff = Date.now() - minutes * 60 * 1000;
    for (const [key, samples] of this.samples) {
      if (key.startsWith(prefix)) {
        const componentId = key.slice(prefix.length);
        result.set(componentId, samples.filter((s) => s.timestamp >= cutoff));
      }
    }
    return result;
  }

  /** Get all component metrics for a node (all pipelines). */
  getAllForNode(nodeId: string, minutes = 60): Map<string, MetricSample[]> {
    const result = new Map<string, MetricSample[]>();
    const prefix = `${nodeId}:`;
    const cutoff = Date.now() - minutes * 60 * 1000;
    for (const [key, samples] of this.samples) {
      if (key.startsWith(prefix)) {
        // Key is nodeId:pipelineId:componentId — extract componentId (after second colon)
        const rest = key.slice(prefix.length);
        const colonIdx = rest.indexOf(":");
        const componentId = colonIdx >= 0 ? rest.slice(colonIdx + 1) : rest;
        // For node-level aggregation, last-write-wins per componentId is acceptable
        result.set(componentId, samples.filter((s) => s.timestamp >= cutoff));
      }
    }
    return result;
  }

  /** Get the latest sample for every component across all nodes. Keyed by "nodeId:pipelineId:componentId". */
  getLatestAll(): Map<string, MetricSample> {
    const result = new Map<string, MetricSample>();
    for (const [key, samples] of this.samples) {
      if (samples.length > 0) {
        result.set(key, samples[samples.length - 1]);
      }
    }
    return result;
  }
}

const globalForMetrics = globalThis as unknown as { metricStore: MetricStore | undefined };
export const metricStore = globalForMetrics.metricStore ?? new MetricStore();
if (process.env.NODE_ENV !== "production") globalForMetrics.metricStore = metricStore;
