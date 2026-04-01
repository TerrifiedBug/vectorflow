import { randomUUID } from "crypto";
import type { MetricUpdateEvent } from "@/lib/sse/types";
import { warnLog } from "@/lib/logger";

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

/** Callback invoked on flush with the batch of metric events. */
export type MetricStoreSubscriber = (events: MetricUpdateEvent[]) => void;

const MAX_SAMPLES = 720; // 1 hour at 5s intervals
const METRIC_STORE_MAX_KEYS = parseInt(process.env.METRIC_STORE_MAX_KEYS ?? "5000", 10);
const BYTES_PER_SAMPLE = 160; // estimated: 9 numeric fields x ~17 bytes + overhead

interface MetricStoreOptions {
  maxKeys?: number;
}

export class MetricStore {
  private samples = new Map<string, MetricSample[]>();
  private prevTotals = new Map<string, PrevTotals>();
  private subscribers = new Map<string, MetricStoreSubscriber>();
  private lastUpdated = new Map<string, number>(); // LRU tracking
  private readonly maxKeys: number;
  private hasWarnedCapacity = false;

  constructor(options?: MetricStoreOptions) {
    this.maxKeys = options?.maxKeys ?? METRIC_STORE_MAX_KEYS;
  }

  /** Number of active pub/sub subscribers. */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /** Register a subscriber. Returns a unique ID for unsubscribe. */
  subscribe(callback: MetricStoreSubscriber): string {
    const id = randomUUID();
    this.subscribers.set(id, callback);
    return id;
  }

  /** Remove a subscriber by ID. */
  unsubscribe(id: string): void {
    this.subscribers.delete(id);
  }

  /** Number of active metric streams. */
  getStreamCount(): number {
    return this.samples.size;
  }

  /** Estimated memory usage in bytes. */
  getEstimatedMemoryBytes(): number {
    let totalSamples = 0;
    for (const arr of this.samples.values()) {
      totalSamples += arr.length;
    }
    return totalSamples * BYTES_PER_SAMPLE;
  }

  private evictIfNeeded(): void {
    while (this.samples.size >= this.maxKeys) {
      // Find least-recently-updated key
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [key, time] of this.lastUpdated) {
        if (time < oldestTime) {
          oldestTime = time;
          oldestKey = key;
        }
      }
      if (oldestKey) {
        this.samples.delete(oldestKey);
        this.prevTotals.delete(oldestKey);
        this.lastUpdated.delete(oldestKey);
      } else {
        break; // Safety: avoid infinite loop
      }
    }
  }

  /**
   * Collect the latest sample for every component of a node+pipeline pair,
   * notify all subscribers with the batch, and return the events.
   *
   * Designed to be called once per pipeline per heartbeat — NOT per component.
   * This batches notifications so 100 pipelines × 5 components = 100 subscriber
   * calls (one per pipeline), not 500.
   */
  flush(nodeId: string, pipelineId: string): MetricUpdateEvent[] {
    const prefix = `${nodeId}:${pipelineId}:`;
    const events: MetricUpdateEvent[] = [];

    for (const [key, samples] of this.samples) {
      if (key.startsWith(prefix) && samples.length > 0) {
        const componentId = key.slice(prefix.length);
        events.push({
          type: "metric_update",
          nodeId,
          pipelineId,
          componentId,
          sample: samples[samples.length - 1],
        });
      }
    }

    if (events.length > 0) {
      for (const callback of this.subscribers.values()) {
        callback(events);
      }
    }

    return events;
  }

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

    const isNewKey = !this.samples.has(key);
    if (isNewKey) {
      this.evictIfNeeded();
    }
    const arr = this.samples.get(key) ?? [];
    arr.push(sample);
    if (arr.length > MAX_SAMPLES) arr.shift();
    this.samples.set(key, arr);
    this.lastUpdated.set(key, now);

    // Check capacity warning after insertion
    if (isNewKey && !this.hasWarnedCapacity && this.samples.size >= this.maxKeys * 0.8) {
      this.hasWarnedCapacity = true;
      warnLog(
        "metric-store",
        `Approaching 80% capacity (${this.samples.size}/${this.maxKeys} streams)`,
      );
    }

    return sample;
  }

  /**
   * Insert a pre-computed sample from a remote instance (cross-instance merge).
   * Respects MAX_SAMPLES cap. Does NOT update prevTotals — rate computation
   * continues independently from local heartbeats.
   */
  mergeSample(nodeId: string, pipelineId: string, componentId: string, sample: MetricSample): void {
    const key = `${nodeId}:${pipelineId}:${componentId}`;
    if (!this.samples.has(key)) {
      this.evictIfNeeded();
    }
    const arr = this.samples.get(key) ?? [];
    arr.push(sample);
    if (arr.length > MAX_SAMPLES) arr.shift();
    this.samples.set(key, arr);
    this.lastUpdated.set(key, sample.timestamp);
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
