"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useDebounce } from "@/hooks/use-debounce";
import { MetricChart, type MetricChartBand } from "@/components/ui/metric-chart";

interface AlertRulePreviewProps {
  teamId: string | null;
  pipelineId: string;
  environmentId: string | null;
  metric: string;
  condition: string;
  threshold: string;
  durationMinutes: string;
}

const LOOKBACK_HOURS = 6;
const CHART_WIDTH = 380;
const CHART_HEIGHT = 140;

/**
 * Live preview for the alert rule editor.
 *
 * Wires the current form state through trpc.alert.testRule and renders
 * "would have fired N times in last 6h" with the metric series + breach
 * windows. Inputs are debounced to avoid hammering the server while typing.
 */
export function AlertRulePreview({
  teamId,
  pipelineId,
  environmentId,
  metric,
  condition,
  threshold,
  durationMinutes,
}: AlertRulePreviewProps) {
  const trpc = useTRPC();

  // Debounce all numeric/string inputs together.
  const debouncedThreshold = useDebounce(threshold, 300);
  const debouncedDuration = useDebounce(durationMinutes, 300);
  const debouncedMetric = useDebounce(metric, 300);
  const debouncedCondition = useDebounce(condition, 300);
  const debouncedPipelineId = useDebounce(pipelineId, 300);

  const thresholdNum = Number(debouncedThreshold);
  const durationSeconds = Math.max(0, Math.round(Number(debouncedDuration) * 60));
  const inputsReady =
    !!teamId &&
    !!debouncedMetric &&
    !!debouncedCondition &&
    debouncedThreshold.trim() !== "" &&
    Number.isFinite(thresholdNum) &&
    Number.isFinite(durationSeconds);

  const previewQuery = useQuery({
    ...trpc.alert.testRule.queryOptions({
      teamId: teamId ?? "",
      pipelineId: debouncedPipelineId || null,
      environmentId: environmentId ?? null,
      metric: debouncedMetric as never,
      condition: debouncedCondition as never,
      threshold: thresholdNum,
      durationSeconds,
      lookbackHours: LOOKBACK_HOURS,
    }),
    enabled: inputsReady,
  });

  if (!inputsReady) {
    return (
      <PreviewShell>
        <div className="px-3 py-6 text-center font-mono text-[11px] text-fg-2">
          Set metric, condition, threshold, and duration to preview history.
        </div>
      </PreviewShell>
    );
  }

  if (previewQuery.isLoading) {
    return (
      <PreviewShell>
        <div className="h-[140px] animate-pulse rounded-[3px] bg-bg-2" />
      </PreviewShell>
    );
  }

  if (previewQuery.error) {
    return (
      <PreviewShell>
        <div className="px-3 py-3 font-mono text-[11px] text-status-error">
          Preview failed: {previewQuery.error.message}
        </div>
      </PreviewShell>
    );
  }

  const data = previewQuery.data;
  if (!data) return <PreviewShell />;

  if (!data.supported) {
    return (
      <PreviewShell>
        <div className="px-3 py-3 font-mono text-[11px] text-fg-2">
          {data.reason}
        </div>
      </PreviewShell>
    );
  }

  const values = data.series.map((p) => p.value);
  const indexByTs = new Map<number, number>();
  data.series.forEach((p, i) => indexByTs.set(p.ts, i));

  const bands: MetricChartBand[] = data.breaches
    .map((b) => {
      const startIndex = indexByTs.get(b.start);
      const endIndex = indexByTs.get(b.end);
      if (startIndex === undefined || endIndex === undefined) return null;
      return { startIndex, endIndex };
    })
    .filter((b): b is MetricChartBand => b !== null);

  const fired = data.wouldHaveFired;
  const empty = values.length === 0;

  return (
    <PreviewShell>
      <div className="mb-2 font-mono text-[11px] leading-tight text-fg-1">
        Would have fired{" "}
        <span className="font-medium text-accent-brand">{fired}</span>{" "}
        time{fired === 1 ? "" : "s"} in last {data.lookbackHours}h
      </div>
      {empty ? (
        <div className="px-3 py-6 text-center font-mono text-[11px] text-fg-2">
          No metric history in the last {data.lookbackHours}h for this pipeline.
        </div>
      ) : (
        <MetricChart
          series={[
            {
              color: "var(--accent-brand)",
              data: values,
            },
          ]}
          width={CHART_WIDTH}
          height={CHART_HEIGHT}
          axis
          smooth
          fill
          bands={bands}
          thresholdY={data.threshold}
        />
      )}
    </PreviewShell>
  );
}

function PreviewShell({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">
        Live preview · last 6h
      </div>
      <div className="mt-2 rounded-[3px] border border-line bg-bg-2 p-3">
        {children}
      </div>
    </div>
  );
}
