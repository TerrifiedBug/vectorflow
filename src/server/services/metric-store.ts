export interface MetricSample {
  timestamp: number;
  receivedEventsRate: number;
  sentEventsRate: number;
  receivedBytesRate: number;
  sentBytesRate: number;
  errorCount: number;
  errorsRate: number;
  discardedRate: number;
}

interface PrevTotals {
  timestamp: number;
  receivedEventsTotal: number;
  sentEventsTotal: number;
  receivedBytesTotal: number;
  sentBytesTotal: number;
  errorsTotal: number;
  discardedTotal: number;
}

const MAX_SAMPLES = 240; // 1 hour at 15s intervals

class MetricStore {
  private samples = new Map<string, MetricSample[]>();
  private prevTotals = new Map<string, PrevTotals>();

  recordTotals(
    nodeId: string,
    componentId: string,
    totals: {
      receivedEventsTotal: number;
      sentEventsTotal: number;
      receivedBytesTotal?: number;
      sentBytesTotal?: number;
      errorsTotal?: number;
      discardedTotal?: number;
    },
  ): MetricSample | null {
    const key = `${nodeId}:${componentId}`;
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
    };

    const arr = this.samples.get(key) ?? [];
    arr.push(sample);
    if (arr.length > MAX_SAMPLES) arr.shift();
    this.samples.set(key, arr);

    return sample;
  }

  getSamples(nodeId: string, componentId: string, minutes = 60): MetricSample[] {
    const key = `${nodeId}:${componentId}`;
    const arr = this.samples.get(key) ?? [];
    const cutoff = Date.now() - minutes * 60 * 1000;
    return arr.filter((s) => s.timestamp >= cutoff);
  }

  getAllForNode(nodeId: string, minutes = 60): Map<string, MetricSample[]> {
    const result = new Map<string, MetricSample[]>();
    const prefix = `${nodeId}:`;
    const cutoff = Date.now() - minutes * 60 * 1000;
    for (const [key, samples] of this.samples) {
      if (key.startsWith(prefix)) {
        const componentId = key.slice(prefix.length);
        result.set(componentId, samples.filter((s) => s.timestamp >= cutoff));
      }
    }
    return result;
  }
}

const globalForMetrics = globalThis as unknown as { metricStore: MetricStore | undefined };
export const metricStore = globalForMetrics.metricStore ?? new MetricStore();
if (process.env.NODE_ENV !== "production") globalForMetrics.metricStore = metricStore;
