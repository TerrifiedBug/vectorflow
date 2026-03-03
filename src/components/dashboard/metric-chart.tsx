"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  LineChart,
  AreaChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { formatTimeAxis } from "@/lib/format";
import type { ReactNode } from "react";

type TSMap = Record<string, { t: number; v: number }[]>;

// 12 perceptually distinct colors (~30° hue spacing) for multi-series charts
const SERIES_COLORS = [
  "oklch(0.65 0.22 41)",    // orange
  "oklch(0.55 0.24 265)",   // blue
  "oklch(0.65 0.17 163)",   // teal
  "oklch(0.63 0.26 304)",   // purple
  "oklch(0.75 0.19 84)",    // yellow
  "oklch(0.65 0.25 17)",    // red
  "oklch(0.60 0.20 146)",   // green
  "oklch(0.70 0.18 200)",   // cyan
  "oklch(0.58 0.22 330)",   // magenta
  "oklch(0.72 0.16 110)",   // lime
  "oklch(0.55 0.20 240)",   // indigo
  "oklch(0.68 0.22 55)",    // amber
];

/** Convert a label to a CSS-safe slug for use as chart config keys */
function toSlug(s: string) {
  return s.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").toLowerCase();
}

interface MetricChartProps {
  title: string;
  icon?: ReactNode;
  /** Primary series (solid lines) */
  data: TSMap;
  /** Secondary series (dashed lines) — for in/out pairs */
  dataSecondary?: TSMap;
  /** "line" (default) or "area" */
  variant?: "line" | "area";
  /** Chart height in pixels */
  height?: number;
  /** Y-axis formatter */
  yFormatter?: (v: number) => string;
  /** Fixed Y-axis domain [min, max], or undefined for auto */
  yDomain?: [number, number];
  /** Time range for X-axis label formatting */
  timeRange: string;
  /** Label suffix for primary series in tooltip (e.g. " In") */
  primaryLabel?: string;
  /** Label suffix for secondary series in tooltip (e.g. " Out") */
  secondaryLabel?: string;
}

export function MetricChart({
  title,
  icon,
  data,
  dataSecondary,
  variant = "line",
  height = 250,
  yFormatter = (v) => String(v),
  yDomain,
  timeRange,
  primaryLabel = "",
  secondaryLabel = "",
}: MetricChartProps) {
  // Merge all series into a unified time-indexed dataset for Recharts
  const { chartData, seriesKeys, chartConfig } = useMemo(() => {
    const allLabels = Object.keys(data);
    const secLabels = dataSecondary ? Object.keys(dataSecondary) : [];

    // Build unique timestamp set
    const tsSet = new Set<number>();
    for (const pts of Object.values(data)) {
      for (const p of pts) tsSet.add(p.t);
    }
    if (dataSecondary) {
      for (const pts of Object.values(dataSecondary)) {
        for (const p of pts) tsSet.add(p.t);
      }
    }

    const timestamps = Array.from(tsSet).sort((a, b) => a - b);

    // Index series by timestamp for O(1) lookup, using CSS-safe slug keys
    const indexed = new Map<string, Map<number, number>>();
    const slugToLabel = new Map<string, string>();
    for (const [label, pts] of Object.entries(data)) {
      const displayLabel = `${label}${primaryLabel}`;
      const slug = toSlug(displayLabel);
      const m = new Map<number, number>();
      for (const p of pts) m.set(p.t, p.v);
      indexed.set(slug, m);
      slugToLabel.set(slug, displayLabel);
    }
    if (dataSecondary) {
      for (const [label, pts] of Object.entries(dataSecondary)) {
        const displayLabel = `${label}${secondaryLabel}`;
        const slug = toSlug(displayLabel);
        const m = new Map<number, number>();
        for (const p of pts) m.set(p.t, p.v);
        indexed.set(slug, m);
        slugToLabel.set(slug, displayLabel);
      }
    }

    const keys = Array.from(indexed.keys());

    // Build chart data using slug keys
    const chartData = timestamps.map((t) => {
      const row: Record<string, number> = { t };
      for (const key of keys) {
        row[key] = indexed.get(key)?.get(t) ?? 0;
      }
      return row;
    });

    // Build chart config with slug keys and display labels
    const config: ChartConfig = {};
    let colorIdx = 0;
    for (const label of allLabels) {
      const color = SERIES_COLORS[colorIdx % SERIES_COLORS.length];
      const priSlug = toSlug(`${label}${primaryLabel}`);
      config[priSlug] = { label: slugToLabel.get(priSlug) ?? label, color };
      if (dataSecondary && secLabels.includes(label)) {
        const secSlug = toSlug(`${label}${secondaryLabel}`);
        config[secSlug] = { label: slugToLabel.get(secSlug) ?? label, color };
      }
      colorIdx++;
    }
    // Any secondary-only labels
    for (const label of secLabels) {
      if (!allLabels.includes(label)) {
        const color = SERIES_COLORS[colorIdx % SERIES_COLORS.length];
        const secSlug = toSlug(`${label}${secondaryLabel}`);
        config[secSlug] = { label: slugToLabel.get(secSlug) ?? label, color };
        colorIdx++;
      }
    }

    return { chartData, seriesKeys: keys, chartConfig: config };
  }, [data, dataSecondary, primaryLabel, secondaryLabel]);

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            {icon}
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="flex items-center justify-center text-xs text-muted-foreground"
            style={{ height }}
          >
            No data for selected filters
          </div>
        </CardContent>
      </Card>
    );
  }

  const Chart = variant === "area" ? AreaChart : LineChart;

  // Determine which slugs are secondary (for dashed styling)
  const secondaryKeys = dataSecondary
    ? Object.keys(dataSecondary).map((l) => toSlug(`${l}${secondaryLabel}`))
    : [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          className="w-full"
          style={{ height }}
        >
          <Chart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
            <XAxis
              dataKey="t"
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => formatTimeAxis(v, timeRange)}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10 }}
              width={55}
              tickFormatter={yFormatter}
              domain={yDomain ?? ["auto", "auto"]}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_value, payload) => {
                    const timestamp = payload?.[0]?.payload?.t;
                    if (!timestamp) return "";
                    return new Date(Number(timestamp)).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    });
                  }}
                  formatter={(value, name) => (
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-muted-foreground">
                        {chartConfig[name as string]?.label ?? name}
                      </span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {yFormatter(value as number)}
                      </span>
                    </div>
                  )}
                />
              }
            />
            {/* Render series */}
            {variant === "area"
              ? seriesKeys.map((key) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={`var(--color-${key})`}
                    fill={`var(--color-${key})`}
                    fillOpacity={0.15}
                    strokeWidth={1.5}
                    strokeDasharray={
                      secondaryKeys.includes(key) ? "5 3" : undefined
                    }
                    dot={false}
                  />
                ))
              : seriesKeys.map((key) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={`var(--color-${key})`}
                    strokeWidth={1.5}
                    strokeDasharray={
                      secondaryKeys.includes(key) ? "5 3" : undefined
                    }
                    dot={false}
                  />
                ))}
            {seriesKeys.length <= 12 && (
              <ChartLegend content={<ChartLegendContent />} />
            )}
          </Chart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
