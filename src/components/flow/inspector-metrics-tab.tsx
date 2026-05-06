"use client";

import type { Node } from "@xyflow/react";
import { MetricChart } from "@/components/ui/metric-chart";
import { formatBytesRate, formatEventsRate, formatSI } from "@/lib/format";

interface MetricSampleLike {
  timestamp: number;
  receivedEventsRate: number;
  sentEventsRate: number;
}

interface MetricsLike {
  eventsPerSec?: number;
  bytesPerSec?: number;
  samples?: MetricSampleLike[];
}

interface InspectorMetricsTabProps {
  node: Node;
}

function buildSeries(metrics: MetricsLike) {
  const samples = metrics.samples?.slice(-12) ?? [];
  if (samples.length > 0) {
    return samples.map((sample) => Math.max(sample.sentEventsRate, sample.receivedEventsRate));
  }

  const fallback = metrics.eventsPerSec ?? 0;
  return Array.from({ length: 8 }, () => fallback);
}

function buildYLabels(values: number[]) {
  const ceiling = Math.max(...values, 0);
  return [0, ceiling * 0.25, ceiling * 0.5, ceiling * 0.75, ceiling].map((value) =>
    formatSI(Math.round(value)),
  );
}

export function InspectorMetricsTab({ node }: InspectorMetricsTabProps) {
  const metrics = ((node.data as { metrics?: MetricsLike }).metrics ?? {}) as MetricsLike;
  const series = buildSeries(metrics);

  return (
    <div className="space-y-3 p-3.5">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border bg-bg-2 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">Events/sec</div>
          <div className="mt-1 text-sm font-medium text-fg">{formatEventsRate(metrics.eventsPerSec)}</div>
        </div>
        <div className="rounded-md border bg-bg-2 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">Bytes/sec</div>
          <div className="mt-1 text-sm font-medium text-fg">{formatBytesRate(metrics.bytesPerSec)}</div>
        </div>
      </div>

      <div className="rounded-md border px-2 py-2">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">Recent throughput</div>
        <MetricChart
          series={[{ name: "Events/sec", color: "var(--accent-brand)", data: series }]}
          width={272}
          height={124}
          yLabels={buildYLabels(series)}
        />
      </div>
    </div>
  );
}
