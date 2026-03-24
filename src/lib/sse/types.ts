import type { MetricSample } from "@/server/services/metric-store";

// ── SSE Event Types ──────────────────────────────────────────────────
// Discriminated union for browser-bound Server-Sent Events.
// Each event carries a `type` literal for client-side dispatch.

/** Metric data for a single pipeline component. */
export interface MetricUpdateEvent {
  type: "metric_update";
  nodeId: string;
  pipelineId: string;
  componentId: string;
  sample: MetricSample;
}

/** Agent/node fleet status change. */
export interface FleetStatusEvent {
  type: "fleet_status";
  nodeId: string;
  status: string;
  timestamp: number;
}

/** Log lines from a pipeline run. */
export interface LogEntryEvent {
  type: "log_entry";
  nodeId: string;
  pipelineId: string;
  lines: string[];
}

/** Pipeline or component status transition. */
export interface StatusChangeEvent {
  type: "status_change";
  nodeId: string;
  fromStatus: string;
  toStatus: string;
  reason: string;
}

/** All SSE event types the browser can receive. */
export type SSEEvent =
  | MetricUpdateEvent
  | FleetStatusEvent
  | LogEntryEvent
  | StatusChangeEvent;
