"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { BarChart3 } from "lucide-react";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { TableSkeleton } from "@/components/ui/loading-skeletons";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { formatTimeAxis } from "@/lib/format";

/** Structurally a subset of the service `LakeSummaryPoint`. */
export interface LakeSummaryPointRow {
  bucket: string;
  series: string;
  value: number;
}

/** Distinct hues for grouped series (oklch, matching the fleet chart palette). */
const SERIES_PALETTE = [
  "oklch(0.55 0.24 265)",
  "oklch(0.65 0.17 163)",
  "oklch(0.70 0.18 50)",
  "oklch(0.60 0.22 350)",
  "oklch(0.65 0.19 120)",
  "oklch(0.62 0.20 20)",
  "oklch(0.60 0.15 220)",
  "oklch(0.68 0.18 90)",
];
const UNGROUPED_KEY = "value";
const EMPTY_SERIES_LABEL = "(empty)";

function formatValue(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return Number.isInteger(v)
    ? v.toLocaleString()
    : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Pivot `LakeSummaryPoint[]` (long form: one row per bucket+series) into the
 * wide form recharts wants ({ t, <seriesKey>: value, … }). Series labels can be
 * arbitrary user data, so each gets a safe synthetic key (`s0`, `s1`, …) for the
 * CSS-var / dataKey; the human label lives in the chart config. Series are
 * ordered by total value (desc) for stable colour assignment.
 */
function buildChartModel(
  points: LakeSummaryPointRow[],
  grouped: boolean,
  metricLabel: string,
): {
  chartData: Record<string, number>[];
  config: ChartConfig;
  seriesKeys: string[];
} {
  if (!grouped) {
    const chartData = points
      .map((p) => ({ t: new Date(p.bucket).getTime(), [UNGROUPED_KEY]: p.value }))
      .sort((a, b) => a.t - b.t);
    const config: ChartConfig = {
      [UNGROUPED_KEY]: { label: metricLabel, color: SERIES_PALETTE[0] },
    };
    return { chartData, config, seriesKeys: [UNGROUPED_KEY] };
  }

  const totals = new Map<string, number>();
  for (const p of points) {
    const label = p.series || EMPTY_SERIES_LABEL;
    totals.set(label, (totals.get(label) ?? 0) + p.value);
  }
  const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);

  const keyByLabel = new Map<string, string>();
  const config: ChartConfig = {};
  const seriesKeys: string[] = [];
  ordered.forEach((label, i) => {
    const key = `s${i}`;
    keyByLabel.set(label, key);
    seriesKeys.push(key);
    config[key] = { label, color: SERIES_PALETTE[i % SERIES_PALETTE.length] };
  });

  const byBucket = new Map<number, Record<string, number>>();
  for (const p of points) {
    const label = p.series || EMPTY_SERIES_LABEL;
    const key = keyByLabel.get(label);
    if (!key) continue;
    const t = new Date(p.bucket).getTime();
    let row = byBucket.get(t);
    if (!row) {
      row = { t };
      byBucket.set(t, row);
    }
    row[key] = p.value;
  }
  const chartData = [...byBucket.values()].sort((a, b) => a.t - b.t);
  return { chartData, config, seriesKeys };
}

export function LakeSummarizeChart({
  data,
  isLoading,
  isError,
  hasSearched,
  grouped,
  range,
  metricLabel,
  onRetry,
}: {
  data: LakeSummaryPointRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  hasSearched: boolean;
  grouped: boolean;
  range: string;
  metricLabel: string;
  onRetry: () => void;
}) {
  const { chartData, config, seriesKeys } = useMemo(
    () => buildChartModel(data ?? [], grouped, metricLabel),
    [data, grouped, metricLabel],
  );

  if (isError) {
    return <QueryError message="Summarize failed" onRetry={onRetry} />;
  }
  if (isLoading) {
    return <TableSkeleton rows={6} />;
  }
  if (!hasSearched) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Summarize events"
        description="Pick a metric (and optional group-by), then run to chart it over time."
        compact
      />
    );
  }
  if (chartData.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No data to summarize"
        description="No events matched your filters in this time window."
        compact
      />
    );
  }

  const tooltip = (
    <ChartTooltip
      content={
        <ChartTooltipContent
          labelFormatter={(_value, payload) => {
            const t = payload?.[0]?.payload?.t;
            if (!t) return "";
            return new Date(Number(t)).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
          }}
          formatter={(value, name) => (
            <div className="flex w-full items-center justify-between gap-2">
              <span className="text-muted-foreground">
                {config[name as string]?.label ?? name}
              </span>
              <span className="font-mono font-medium tabular-nums text-foreground">
                {formatValue(value as number)}
              </span>
            </div>
          )}
        />
      }
    />
  );

  const xAxis = (
    <XAxis
      dataKey="t"
      tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
      tickFormatter={(v) => formatTimeAxis(v, range)}
      interval="preserveStartEnd"
    />
  );
  const yAxis = (
    <YAxis
      tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
      width={56}
      tickFormatter={(v) => formatValue(v as number)}
      domain={["auto", "auto"]}
    />
  );

  return (
    <ChartContainer config={config} className="w-full" style={{ height: 320 }}>
      {grouped ? (
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
          {xAxis}
          {yAxis}
          {tooltip}
          <ChartLegend content={<ChartLegendContent />} />
          {seriesKeys.map((key) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={`var(--color-${key})`}
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      ) : (
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
          {xAxis}
          {yAxis}
          {tooltip}
          <Bar dataKey={UNGROUPED_KEY} fill={`var(--color-${UNGROUPED_KEY})`} radius={[2, 2, 0, 0]} />
        </BarChart>
      )}
    </ChartContainer>
  );
}
