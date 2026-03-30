"use client";

import { useEffect, useRef } from "react";
import type { MetricUpdateEvent } from "@/lib/sse/types";
import type { MetricSample } from "@/server/services/metric-store";
import type { NodeMetricsData } from "@/stores/flow-store";
import { useSSE } from "@/hooks/use-sse";
import { useFlowStore } from "@/stores/flow-store";

// ── Constants ────────────────────────────────────────────────────────

const MAX_SAMPLES = 60;

// ── Kind → rate field mapping ────────────────────────────────────────
// Matches the existing logic in pipelines/[id]/page.tsx lines 200–210.
// - events: received rate for sources/sinks, sent rate for transforms (post-filter output)
// - bytes: received for sources/transforms (I/O in), sent for sinks (I/O out)
// - transforms also carry eventsInPerSec (received = pre-filter input)

export type NodeKind = "source" | "transform" | "sink";

/**
 * Derive NodeMetricsData from a MetricSample using kind-specific rate fields.
 * Exported for direct unit testing without React hook mocking.
 */
export function deriveMetrics(
  kind: NodeKind,
  latest: MetricSample,
  samples: MetricSample[],
): NodeMetricsData {
  const eventsPerSec =
    kind === "transform"
      ? latest.sentEventsRate
      : kind === "source"
        ? (latest.receivedEventsRate || latest.sentEventsRate)
        : latest.receivedEventsRate;

  const bytesPerSec =
    kind === "sink"
      ? latest.sentBytesRate
      : latest.receivedBytesRate;

  return {
    eventsPerSec,
    bytesPerSec,
    ...(kind === "transform"
      ? { eventsInPerSec: latest.receivedEventsRate }
      : {}),
    status: eventsPerSec > 0 ? "healthy" : "degraded",
    samples,
    latencyMs: latest.latencyMeanMs,
  };
}

// ── Hook ─────────────────────────────────────────────────────────────

/**
 * Bridges SSE `metric_update` events into the flow store's `updateNodeMetrics`.
 *
 * Subscribes to metric_update events, filters by pipelineId, accumulates a
 * per-component sample buffer (capped at 60), resolves node kind from the
 * flow store, and pushes the rebuilt NodeMetricsData map.
 */
export function useFlowMetrics(pipelineId: string): void {
  const { subscribe, unsubscribe } = useSSE();

  // Per-component sample buffer, keyed by componentId.
  const bufferRef = useRef<Map<string, MetricSample[]>>(new Map());

  useEffect(() => {
    const buffer = bufferRef.current;
    const subId = subscribe("metric_update", (event) => {
      const e = event as MetricUpdateEvent;

      // Filter: only process events for the target pipeline
      if (e.pipelineId !== pipelineId) return;

      // Accumulate sample into buffer
      let samples = buffer.get(e.componentId);
      if (!samples) {
        samples = [];
        buffer.set(e.componentId, samples);
      }
      samples.push(e.sample);

      // Cap at MAX_SAMPLES — trim from the front
      if (samples.length > MAX_SAMPLES) {
        buffer.set(e.componentId, samples.slice(-MAX_SAMPLES));
        samples = buffer.get(e.componentId)!;
      }

      // Rebuild full metrics map from buffer
      const metricsMap = new Map<string, NodeMetricsData>();
      const nodes = useFlowStore.getState().nodes;

      for (const [componentId, componentSamples] of buffer) {
        // Resolve node kind from flow store
        const node = nodes.find(
          (n) =>
            (n.data as Record<string, unknown>).componentKey === componentId,
        );
        if (!node?.type) continue; // stale event — no matching node

        const kind = node.type as NodeKind;
        const latest = componentSamples[componentSamples.length - 1];
        if (!latest) continue;

        metricsMap.set(componentId, deriveMetrics(kind, latest, componentSamples));
      }

      if (metricsMap.size > 0) {
        useFlowStore.getState().updateNodeMetrics(metricsMap);
      }
    });

    return () => {
      unsubscribe(subId);
      buffer.clear();
    };
  }, [pipelineId, subscribe, unsubscribe]);
}
